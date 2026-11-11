import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../../src/db";
import { runs, stepRuns, workflows } from "../../src/db/schema";
import { claimRun, enqueueDueSchedules, enqueueRun } from "../../src/engine/queue";
import type { Step } from "../../src/engine/types";
import { processRun, startWorker } from "../../src/engine/worker";

const deps = { policy: { allowPrivate: true, allowedHosts: [] } };

let server: Server;
let base: string;
let hits: Record<string, number> = {};
let received: unknown[] = [];

beforeAll(async () => {
  await migrate(db(), { migrationsFolder: "./drizzle" });
  server = createServer((request, response) => {
    const path = request.url ?? "/";
    hits[path] = (hits[path] ?? 0) + 1;
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const json = (status: number, payload: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      if (path === "/echo") {
        received.push(JSON.parse(body || "null"));
        return json(200, { ok: true });
      }
      if (path === "/flaky") return hits[path] < 3 ? json(503, { error: "down" }) : json(200, { call: hits[path] });
      if (path === "/broken") return json(500, { error: "always" });
      if (path === "/missing") return json(404, { error: "nope" });
      return json(200, { value: 42 });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDb();
});

beforeEach(async () => {
  await db().execute(sql`truncate workflows cascade`);
  hits = {};
  received = [];
});

async function createWorkflow(steps: Step[], extra: Partial<typeof workflows.$inferInsert> = {}) {
  const [workflow] = await db()
    .insert(workflows)
    .values({ name: "test", triggerType: "manual", steps, ...extra })
    .returning();
  return workflow;
}

const start = (workflow: { id: string; steps: Step[] }, body?: unknown) =>
  enqueueRun(db(), workflow, { type: "manual", firedAt: new Date().toISOString(), body });

const makeDue = (id: string) => db().update(runs).set({ runAt: sql`now()` }).where(eq(runs.id, id));

async function drain(id: string, workerId = "w1") {
  for (let pass = 0; pass < 10; pass += 1) {
    await makeDue(id);
    const claimed = await claimRun(db(), workerId);
    if (!claimed) break;
    await processRun(db(), claimed, workerId, deps);
  }
  const [run] = await db().select().from(runs).where(eq(runs.id, id));
  const steps = await db().select().from(stepRuns).where(eq(stepRuns.runId, id)).orderBy(stepRuns.startedAt);
  return { run, steps };
}

const get = (id: string, path: string): Step => ({ id, type: "http", method: "GET", url: `${base}${path}`, headers: {}, body: "" });

describe("running a workflow", () => {
  it("passes data from the trigger and earlier steps to later ones", async () => {
    const workflow = await createWorkflow([
      get("fetch", "/value"),
      { id: "shape", type: "transform", values: { doubled: "{{steps.fetch.body.value}}", who: "{{trigger.body.name}}" } },
      {
        id: "send",
        type: "http",
        method: "POST",
        url: `${base}/echo`,
        headers: {},
        body: '{"n": {{steps.shape.doubled}}, "who": "{{steps.shape.who}}"}',
      },
    ]);
    const { run, steps } = await drain(await start(workflow, { name: "Ada" }));
    expect(run).toMatchObject({ status: "succeeded", cursor: 3, lockedBy: null });
    expect(run.finishedAt).not.toBeNull();
    expect(steps.map((step) => [step.stepId, step.status])).toEqual([
      ["fetch", "succeeded"],
      ["shape", "succeeded"],
      ["send", "succeeded"],
    ]);
    expect(received).toEqual([{ n: 42, who: "Ada" }]);
  });

  it("stops quietly when a filter does not pass", async () => {
    const workflow = await createWorkflow([
      { id: "big", type: "filter", left: "{{trigger.body.amount}}", operator: "greater_than", right: "100" },
      get("after", "/value"),
    ]);
    const { run, steps } = await drain(await start(workflow, { amount: 5 }));
    expect(run.status).toBe("stopped");
    expect(steps).toHaveLength(1);
    expect(hits["/value"]).toBeUndefined();
  });

  it("retries a failing step with backoff and then continues", async () => {
    const workflow = await createWorkflow([get("unstable", "/flaky"), get("after", "/value")]);
    const id = await start(workflow);

    const first = await claimRun(db(), "w1");
    await processRun(db(), first!, "w1", deps);
    const [waiting] = await db().select().from(runs).where(eq(runs.id, id));
    expect(waiting).toMatchObject({ status: "queued", cursor: 0, attempt: 2, error: "The server answered 503." });
    expect(waiting.runAt.getTime()).toBeGreaterThan(Date.now() + 1000);
    expect(await claimRun(db(), "w1")).toBeNull();

    const { run, steps } = await drain(id);
    expect(run).toMatchObject({ status: "succeeded", error: null });
    expect(steps.map((step) => [step.stepId, step.attempt, step.status])).toEqual([
      ["unstable", 1, "retrying"],
      ["unstable", 2, "retrying"],
      ["unstable", 3, "succeeded"],
      ["after", 1, "succeeded"],
    ]);
  });

  it("fails after the last attempt and keeps the server's answer", async () => {
    const workflow = await createWorkflow([get("down", "/broken"), get("never", "/value")]);
    const { run, steps } = await drain(await start(workflow));
    expect(run).toMatchObject({ status: "failed", cursor: 0, error: "The server answered 500." });
    expect(steps).toHaveLength(4);
    expect(steps.at(-1)).toMatchObject({ status: "failed", attempt: 4, output: { status: 500 } });
    expect(hits["/value"]).toBeUndefined();
  });

  it("does not retry errors that retrying cannot fix", async () => {
    const workflow = await createWorkflow([get("gone", "/missing")]);
    const { run, steps } = await drain(await start(workflow));
    expect(run.status).toBe("failed");
    expect(steps).toHaveLength(1);
    expect(hits["/missing"]).toBe(1);
  });

  it("parks a run during a delay instead of holding a worker", async () => {
    const workflow = await createWorkflow([{ id: "wait", type: "delay", seconds: 120 }, get("after", "/value")]);
    const id = await start(workflow);
    await processRun(db(), (await claimRun(db(), "w1"))!, "w1", deps);

    const [parked] = await db().select().from(runs).where(eq(runs.id, id));
    expect(parked).toMatchObject({ status: "queued", cursor: 1, lockedBy: null });
    expect(parked.runAt.getTime()).toBeGreaterThan(Date.now() + 100_000);
    expect(await claimRun(db(), "w2")).toBeNull();
    expect(hits["/value"]).toBeUndefined();

    const { run } = await drain(id);
    expect(run.status).toBe("succeeded");
  });

  it("keeps running the original steps after the workflow is edited", async () => {
    const workflow = await createWorkflow([get("original", "/value")]);
    const id = await start(workflow);
    await db().update(workflows).set({ steps: [get("changed", "/broken")] }).where(eq(workflows.id, workflow.id));
    const { run, steps } = await drain(id);
    expect(run.status).toBe("succeeded");
    expect(steps[0].stepId).toBe("original");
  });
});

describe("the queue", () => {
  it("never hands the same run to two workers", async () => {
    const workflow = await createWorkflow([get("a", "/value")]);
    const ids = await Promise.all(Array.from({ length: 8 }, () => start(workflow)));
    const claims = await Promise.all(Array.from({ length: 20 }, (_, index) => claimRun(db(), `w${index}`)));
    const claimed = claims.filter((run) => run !== null).map((run) => run.id);
    expect(claimed).toHaveLength(8);
    expect(new Set(claimed)).toEqual(new Set(ids));
  });

  it("recovers a run whose worker died, without repeating finished steps", async () => {
    const workflow = await createWorkflow([
      { id: "first", type: "http", method: "POST", url: `${base}/echo`, headers: {}, body: '{"step": 1}' },
      { id: "wait", type: "delay", seconds: 1 },
      { id: "second", type: "http", method: "POST", url: `${base}/echo`, headers: {}, body: '{"step": 2}' },
    ]);
    const id = await start(workflow);
    await processRun(db(), (await claimRun(db(), "doomed"))!, "doomed", deps);
    expect(received).toEqual([{ step: 1 }]);

    await makeDue(id);
    const stuck = await claimRun(db(), "doomed");
    expect(stuck).toMatchObject({ status: "running", cursor: 2 });
    expect(await claimRun(db(), "rescuer")).toBeNull();

    await db().update(runs).set({ lockedUntil: sql`now() - interval '1 second'` }).where(eq(runs.id, id));
    const rescued = await claimRun(db(), "rescuer");
    expect(rescued).toMatchObject({ id, cursor: 2, lockedBy: "rescuer" });
    await processRun(db(), rescued!, "rescuer", deps);

    const [run] = await db().select().from(runs).where(eq(runs.id, id));
    expect(run.status).toBe("succeeded");
    expect(received).toEqual([{ step: 1 }, { step: 2 }]);
  });

  it("discards the result of a worker that lost its lease", async () => {
    const workflow = await createWorkflow([get("a", "/value"), get("b", "/value")]);
    const id = await start(workflow);
    const slow = await claimRun(db(), "slow");
    await db().update(runs).set({ lockedUntil: sql`now() - interval '1 second'` }).where(eq(runs.id, id));
    const fast = await claimRun(db(), "fast");
    await processRun(db(), fast!, "fast", deps);
    await processRun(db(), slow!, "slow", deps);

    const steps = await db().select().from(stepRuns).where(eq(stepRuns.runId, id));
    expect(steps.map((step) => step.stepId).sort()).toEqual(["a", "b"]);
    const [run] = await db().select().from(runs).where(eq(runs.id, id));
    expect(run.status).toBe("succeeded");
  });
});

describe("schedules", () => {
  it("enqueues each due workflow exactly once, even with competing schedulers", async () => {
    const due = { triggerType: "schedule" as const, intervalMinutes: 15, nextRunAt: new Date(Date.now() - 1000) };
    const first = await createWorkflow([get("a", "/value")], due);
    await createWorkflow([get("a", "/value")], { ...due, enabled: false });
    await createWorkflow([get("a", "/value")], { ...due, nextRunAt: new Date(Date.now() + 60_000) });

    const fired = await Promise.all(Array.from({ length: 5 }, () => enqueueDueSchedules(db())));
    expect(fired.reduce((sum, count) => sum + count, 0)).toBe(1);

    const queued = await db().select().from(runs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ workflowId: first.id, trigger: { type: "schedule" } });

    const [advanced] = await db().select().from(workflows).where(eq(workflows.id, first.id));
    expect(advanced.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });
});

describe("the worker loop", () => {
  it("picks up queued runs and shuts down cleanly", async () => {
    const workflow = await createWorkflow([get("a", "/value"), { id: "t", type: "transform", values: { v: "{{steps.a.body.value}}" } }]);
    const ids = await Promise.all(Array.from({ length: 6 }, () => start(workflow)));
    const worker = startWorker({ database: db(), workerId: "loop", concurrency: 3, pollMs: 50, deps });

    const deadline = Date.now() + 15_000;
    let done = 0;
    while (Date.now() < deadline && done < ids.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const finished = await db().select({ id: runs.id }).from(runs).where(eq(runs.status, "succeeded"));
      done = finished.length;
    }
    await worker.stop();
    expect(done).toBe(6);
    expect(hits["/value"]).toBe(6);
  });
});
