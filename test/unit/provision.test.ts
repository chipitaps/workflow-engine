import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DefinitionError, parseDefinition, substitute } from "../../src/engine/provision";

const env = { APP_URL: "http://app:3000", SECRET: "s3cret-value" };

const definition = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    slug: "ticket-triage",
    name: "Triage",
    trigger: { type: "webhook", token: "abcdefghijklmnopqrstuv" },
    steps: [
      {
        id: "call",
        type: "http",
        method: "POST",
        url: "${APP_URL}/api/x/{{trigger.body.id}}",
        headers: { authorization: "Bearer ${SECRET}" },
      },
    ],
    ...overrides,
  });

describe("substitute", () => {
  it("replaces environment placeholders at any depth and leaves templates alone", () => {
    expect(substitute({ a: ["${APP_URL}/x", { b: "{{steps.a.b}} ${SECRET}" }], n: 3 }, env)).toEqual({
      a: ["http://app:3000/x", { b: "{{steps.a.b}} s3cret-value" }],
      n: 3,
    });
  });

  it("fails loudly when a variable is missing or empty", () => {
    expect(() => substitute("${NOPE}", env)).toThrow(/NOPE is not set/);
    expect(() => substitute("${EMPTY}", { EMPTY: "" })).toThrow(DefinitionError);
  });

  it("ignores text that only looks like a placeholder", () => {
    expect(substitute("costs $5 {not} ${lowercase}", env)).toBe("costs $5 {not} ${lowercase}");
  });
});

describe("parseDefinition", () => {
  it("resolves placeholders, applies defaults and validates the steps", () => {
    const parsed = parseDefinition(definition(), env);
    expect(parsed).toMatchObject({ slug: "ticket-triage", enabled: true, trigger: { type: "webhook" } });
    expect(parsed.steps[0]).toMatchObject({
      url: "http://app:3000/api/x/{{trigger.body.id}}",
      headers: { authorization: "Bearer s3cret-value" },
      body: "",
    });
  });

  it("names the file and the problem when something is wrong", () => {
    expect(() => parseDefinition("{not json", env, "broken.json")).toThrow("broken.json: not valid JSON.");
    expect(() => parseDefinition(definition({ slug: "Bad Slug" }), env, "a.json")).toThrow(/a.json: Slugs use/);
    expect(() => parseDefinition(definition({ steps: [] }), env, "a.json")).toThrow(/Add at least one step/);
    expect(() => parseDefinition(definition(), {}, "a.json")).toThrow(/a.json: The environment variable/);
  });

  it("rejects short webhook tokens, unknown fields and schedules without an interval", () => {
    expect(() => parseDefinition(definition({ trigger: { type: "webhook", token: "short" } }), env)).toThrow(DefinitionError);
    expect(() => parseDefinition(definition({ owner: "me" }), env)).toThrow(DefinitionError);
    expect(() => parseDefinition(definition({ trigger: { type: "schedule" } }), env)).toThrow(DefinitionError);
  });

  it("accepts every example shipped with the engine", () => {
    const directory = join(__dirname, "../../workflows/examples");
    const files = readdirSync(directory).filter((file) => file.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const parsed = parseDefinition(readFileSync(join(directory, file), "utf8"), { DEMO_BASE_URL: "http://app:3000" }, file);
      expect(parsed.steps.length).toBeGreaterThan(0);
    }
  });
});
