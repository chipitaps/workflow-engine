import { describe, expect, it } from "vitest";
import { executeStep } from "../../src/engine/execute";
import { describeIssue, stepsSchema, workflowSchema, type Context, type Step } from "../../src/engine/types";
import { duration, everyLabel, relativeTime } from "../../src/lib/format";

const context: Context = {
  run: { id: "run-1" },
  trigger: { type: "webhook", firedAt: "2026-11-10T00:00:00Z", body: { name: "Ada", amount: 120 } },
  steps: { previous: { total: 3 } },
};
const open = { allowPrivate: true, allowedHosts: [] };

const respond =
  (status: number, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

const http = (overrides: Partial<Extract<Step, { type: "http" }>> = {}): Step => ({
  id: "call",
  type: "http",
  method: "POST",
  url: "https://api.example.com/users/{{trigger.body.name}}",
  headers: { "X-Total": "{{steps.previous.total}}" },
  body: '{"amount": {{trigger.body.amount}}}',
  ...overrides,
});

describe("executeStep: http", () => {
  it("renders templates into the request and parses a JSON response", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const result = await executeStep(http(), context, {
      policy: open,
      fetch: (async (url: URL, init: RequestInit) => {
        seen = { url: String(url), init };
        return new Response('{"ok":true}', { status: 201, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
    expect(seen?.url).toBe("https://api.example.com/users/Ada");
    expect(seen?.init.body).toBe('{"amount": 120}');
    expect(seen?.init.headers).toMatchObject({
      "x-total": "3",
      "content-type": "application/json",
      "idempotency-key": "run-1:call",
    });
    expect(result.outcome).toEqual({ kind: "ok" });
    expect(result.output).toMatchObject({ status: 201, body: { ok: true } });
  });

  it("sends secrets in headers but never records them", async () => {
    let sent: Record<string, string> = {};
    const result = await executeStep(
      http({ headers: { Authorization: "Bearer top-secret", "X-Api-Key": "k-123", "X-Trace": "abc" } }),
      context,
      {
        policy: open,
        fetch: (async (_url: URL, init: RequestInit) => {
          sent = init.headers as Record<string, string>;
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        }) as typeof fetch,
      },
    );
    expect(sent).toMatchObject({ authorization: "Bearer top-secret", "x-api-key": "k-123" });
    expect((result.input as { headers: Record<string, string> }).headers).toMatchObject({
      authorization: "[redacted]",
      "x-api-key": "[redacted]",
      "x-trace": "abc",
      "idempotency-key": "run-1:call",
    });
    expect(JSON.stringify(result)).not.toContain("top-secret");
  });

  it("sends a whole object from an earlier step as valid JSON", async () => {
    let body = "";
    const tricky = { ...context, steps: { built: { note: 'She said "hi"\nand left', n: 2 } } };
    await executeStep(http({ body: "{{steps.built}}" }), tricky, {
      policy: open,
      fetch: (async (_url: URL, init: RequestInit) => {
        body = String(init.body);
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(JSON.parse(body)).toEqual({ note: 'She said "hi"\nand left', n: 2 });
  });

  it("treats 5xx and 429 as retryable and other 4xx as final", async () => {
    const unavailable = await executeStep(http(), context, { policy: open, fetch: respond(503, { error: "down" }) as typeof fetch });
    expect(unavailable.outcome).toMatchObject({ kind: "error", retryable: true });
    expect(unavailable.output).toMatchObject({ status: 503 });

    const limited = await executeStep(http(), context, { policy: open, fetch: respond(429, {}) as typeof fetch });
    expect(limited.outcome).toMatchObject({ kind: "error", retryable: true });

    const missing = await executeStep(http(), context, { policy: open, fetch: respond(404, {}) as typeof fetch });
    expect(missing.outcome).toMatchObject({ kind: "error", retryable: false });
  });

  it("retries network failures", async () => {
    const result = await executeStep(http(), context, {
      policy: open,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    expect(result.outcome).toMatchObject({ kind: "error", retryable: true, message: "The request failed." });
  });

  it("refuses private addresses before sending anything", async () => {
    let called = false;
    const result = await executeStep(http({ url: "http://169.254.169.254/latest" }), context, {
      policy: { allowPrivate: false, allowedHosts: [] },
      fetch: (async () => {
        called = true;
        return new Response("");
      }) as typeof fetch,
    });
    expect(called).toBe(false);
    expect(result.outcome).toMatchObject({ kind: "error", retryable: false });
  });

  it("re-checks the destination of every redirect", async () => {
    const result = await executeStep(http({ method: "GET", body: "" }), context, {
      policy: { allowPrivate: false, allowedHosts: ["api.example.com"] },
      fetch: (async () =>
        new Response("", { status: 302, headers: { location: "http://127.0.0.1:5432/" } })) as typeof fetch,
    });
    expect(result.outcome).toMatchObject({ kind: "error", retryable: false });
  });

  it("returns non-JSON bodies as text", async () => {
    const result = await executeStep(http(), context, {
      policy: open,
      fetch: respond(200, "hello", { "content-type": "text/plain" }) as typeof fetch,
    });
    expect(result.output).toMatchObject({ body: "hello" });
  });
});

describe("executeStep: other steps", () => {
  it("builds an object in a transform, keeping value types", async () => {
    const result = await executeStep(
      { id: "t", type: "transform", values: { greeting: "Hi {{trigger.body.name}}", amount: "{{trigger.body.amount}}" } },
      context,
    );
    expect(result.output).toEqual({ greeting: "Hi Ada", amount: 120 });
  });

  it("continues or stops in a filter", async () => {
    const filter = (right: string): Step => ({
      id: "f",
      type: "filter",
      left: "{{trigger.body.amount}}",
      operator: "greater_than",
      right,
    });
    expect((await executeStep(filter("100"), context)).outcome).toEqual({ kind: "ok" });
    expect((await executeStep(filter("500"), context)).outcome).toEqual({ kind: "stop" });
  });

  it("asks the engine to wait in a delay", async () => {
    const result = await executeStep({ id: "d", type: "delay", seconds: 30 }, context);
    expect(result.outcome).toEqual({ kind: "wait", ms: 30000 });
  });
});

describe("workflow validation", () => {
  const step = { id: "a", type: "delay", seconds: 5 };

  it("accepts a valid workflow and coerces numbers", () => {
    const parsed = workflowSchema.parse({
      name: " Digest ",
      triggerType: "schedule",
      intervalMinutes: "30",
      steps: [{ ...step, seconds: "5" }],
    });
    expect(parsed).toMatchObject({ name: "Digest", intervalMinutes: 30, steps: [{ seconds: 5 }] });
  });

  it("requires an interval for scheduled workflows", () => {
    const result = workflowSchema.safeParse({ name: "x", triggerType: "schedule", intervalMinutes: null, steps: [step] });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate step ids, bad ids and empty workflows with readable messages", () => {
    const duplicate = stepsSchema.safeParse([step, step]);
    expect(duplicate.success).toBe(false);
    expect(stepsSchema.safeParse([{ ...step, id: "Not Valid" }]).success).toBe(false);
    expect(stepsSchema.safeParse([]).success).toBe(false);

    const bad = workflowSchema.safeParse({
      name: "x",
      triggerType: "manual",
      intervalMinutes: null,
      steps: [step, { id: "b", type: "http", method: "GET", url: "" }],
    });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(describeIssue(bad.error)).toBe("Step 2: The request needs a URL.");
  });

  it("rejects unknown step types and out-of-range delays", () => {
    expect(stepsSchema.safeParse([{ id: "a", type: "shell", command: "rm -rf /" }]).success).toBe(false);
    expect(stepsSchema.safeParse([{ id: "a", type: "delay", seconds: 999999 }]).success).toBe(false);
  });
});

describe("format", () => {
  it("formats durations", () => {
    expect(duration(420)).toBe("420 ms");
    expect(duration(2500)).toBe("2.5 s");
    expect(duration(75_000)).toBe("1 min 15 s");
    expect(duration(3_900_000)).toBe("1 h 5 min");
  });

  it("formats relative times in both directions", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(relativeTime(new Date("2026-11-10T11:59:58Z"), now)).toBe("just now");
    expect(relativeTime(new Date("2026-11-10T11:55:00Z"), now)).toBe("5 min ago");
    expect(relativeTime(new Date("2026-11-10T12:00:30Z"), now)).toBe("in 30 s");
    expect(relativeTime(new Date("2026-11-08T12:00:00Z"), now)).toBe("2 d ago");
  });

  it("describes schedules", () => {
    expect(everyLabel(1)).toBe("every minute");
    expect(everyLabel(30)).toBe("every 30 minutes");
    expect(everyLabel(60)).toBe("every hour");
    expect(everyLabel(2880)).toBe("every 2 days");
  });
});
