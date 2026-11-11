import { describe, expect, it } from "vitest";
import { lookup, references, render, resolve } from "../../src/engine/template";

const context = {
  trigger: { body: { name: "Ada", tags: ["a", "b"], plan: { tier: "pro", seats: 3 }, active: false } },
  steps: { fetch: { status: 200, body: { items: [{ title: "First" }, { title: "Second" }] } } },
};

describe("lookup", () => {
  it("walks objects and arrays with dot paths", () => {
    expect(lookup(context, "trigger.body.name")).toBe("Ada");
    expect(lookup(context, "steps.fetch.body.items.1.title")).toBe("Second");
  });

  it("returns undefined for anything missing", () => {
    expect(lookup(context, "trigger.body.missing")).toBeUndefined();
    expect(lookup(context, "trigger.body.name.length.more")).toBeUndefined();
    expect(lookup(context, "steps.unknown.body")).toBeUndefined();
  });

  it("does not expose prototype properties", () => {
    expect(lookup(context, "trigger.__proto__")).toBeUndefined();
    expect(lookup(context, "trigger.constructor")).toBeUndefined();
    expect(lookup(context, "trigger.toString")).toBeUndefined();
    expect(lookup(context, "trigger.body.tags.map")).toBeUndefined();
  });

  it("reads the length of a list", () => {
    expect(lookup(context, "trigger.body.tags.length")).toBe(2);
  });
});

describe("render", () => {
  it("interpolates values into text", () => {
    expect(render("Hi {{trigger.body.name}}, status {{ steps.fetch.status }}", context)).toBe("Hi Ada, status 200");
  });

  it("renders missing values as empty and objects as JSON", () => {
    expect(render("[{{trigger.body.nope}}]", context)).toBe("[]");
    expect(render("{{trigger.body.plan}}", context)).toBe('{"tier":"pro","seats":3}');
    expect(render("{{trigger.body.active}}", context)).toBe("false");
  });

  it("leaves text without tags alone", () => {
    expect(render("plain { text }", context)).toBe("plain { text }");
  });
});

describe("resolve", () => {
  it("keeps the original type when the template is a single tag", () => {
    expect(resolve("{{steps.fetch.status}}", context)).toBe(200);
    expect(resolve(" {{trigger.body.tags}} ", context)).toEqual(["a", "b"]);
    expect(resolve("{{trigger.body.active}}", context)).toBe(false);
  });

  it("returns null for a missing single tag and text otherwise", () => {
    expect(resolve("{{trigger.body.nope}}", context)).toBeNull();
    expect(resolve("{{steps.fetch.status}} OK", context)).toBe("200 OK");
    expect(resolve("literal", context)).toBe("literal");
  });
});

describe("references", () => {
  it("lists the paths a template uses", () => {
    expect(references("{{a.b}} and {{ c.d }}")).toEqual(["a.b", "c.d"]);
    expect(references("none")).toEqual([]);
  });
});
