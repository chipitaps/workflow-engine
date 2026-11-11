import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../../src/db";
import { workflows } from "../../src/db/schema";
import { DefinitionError, provision, type Definition } from "../../src/engine/provision";

const step = { id: "wait", type: "delay" as const, seconds: 5 };

const webhook = (overrides: Partial<Definition> = {}): Definition => ({
  slug: "triage",
  name: "Triage",
  enabled: true,
  trigger: { type: "webhook" },
  steps: [step],
  ...overrides,
});

const bySlug = async (slug: string) => (await db().select().from(workflows).where(eq(workflows.slug, slug)))[0];

beforeAll(async () => {
  await migrate(db(), { migrationsFolder: "./drizzle" });
});

afterAll(closeDb);

beforeEach(async () => {
  await db().execute(sql`truncate workflows cascade`);
});

describe("provision", () => {
  it("creates workflows and generates a webhook token when none is given", async () => {
    await provision(db(), [webhook()]);
    const created = await bySlug("triage");
    expect(created).toMatchObject({ name: "Triage", triggerType: "webhook", enabled: true });
    expect(created.webhookToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it("updates in place when applied again, keeping the id and the generated token", async () => {
    await provision(db(), [webhook()]);
    const before = await bySlug("triage");
    await provision(db(), [webhook({ name: "Triage v2", steps: [step, { ...step, id: "again" }] })]);
    const after = await bySlug("triage");

    expect(after.id).toBe(before.id);
    expect(after.webhookToken).toBe(before.webhookToken);
    expect(after).toMatchObject({ name: "Triage v2" });
    expect(after.steps).toHaveLength(2);
    expect(await db().select().from(workflows)).toHaveLength(1);
  });

  it("uses the token from the definition when there is one", async () => {
    await provision(db(), [webhook()]);
    await provision(db(), [webhook({ trigger: { type: "webhook", token: "shared-token-0123456789" } })]);
    expect((await bySlug("triage")).webhookToken).toBe("shared-token-0123456789");
  });

  it("keeps a schedule's next run when the interval is unchanged and resets it when it changes", async () => {
    const schedule = (everyMinutes: number) =>
      webhook({ slug: "digest", trigger: { type: "schedule", everyMinutes } });
    await provision(db(), [schedule(60)]);
    const first = await bySlug("digest");
    expect(first.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 60_000);

    await provision(db(), [schedule(60)]);
    expect((await bySlug("digest")).nextRunAt).toEqual(first.nextRunAt);

    await provision(db(), [schedule(5)]);
    const changed = await bySlug("digest");
    expect(changed.intervalMinutes).toBe(5);
    expect(changed.nextRunAt!.getTime()).toBeLessThan(Date.now() + 6 * 60_000);
  });

  it("clears trigger settings when the trigger type changes", async () => {
    await provision(db(), [webhook()]);
    await provision(db(), [webhook({ trigger: { type: "manual" } })]);
    expect(await bySlug("triage")).toMatchObject({ triggerType: "manual", webhookToken: null, nextRunAt: null });
  });

  it("leaves workflows created in the interface untouched", async () => {
    await db().insert(workflows).values({ name: "By hand", triggerType: "manual", steps: [step] });
    await provision(db(), [webhook()]);
    expect(await db().select().from(workflows)).toHaveLength(2);
  });

  it("refuses two definitions with the same slug before writing anything", async () => {
    await expect(provision(db(), [webhook(), webhook()])).rejects.toThrow(DefinitionError);
    expect(await db().select().from(workflows)).toHaveLength(0);
  });
});
