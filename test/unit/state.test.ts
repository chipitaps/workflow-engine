import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/conditions";
import { advance, backoffMs, MAX_ATTEMPTS } from "../../src/engine/state";

const at = (cursor: number, attempt = 1, totalSteps = 3) => ({ cursor, attempt, totalSteps });

describe("advance", () => {
  it("moves to the next step after a success", () => {
    expect(advance(at(0), { kind: "ok" })).toMatchObject({ status: "queued", cursor: 1, attempt: 1, delayMs: 0 });
  });

  it("finishes the run after the last step", () => {
    expect(advance(at(2), { kind: "ok" })).toMatchObject({ status: "succeeded", cursor: 3, stepStatus: "succeeded" });
  });

  it("resets the attempt counter once a retried step succeeds", () => {
    expect(advance(at(1, 3), { kind: "ok" })).toMatchObject({ cursor: 2, attempt: 1 });
  });

  it("re-queues the run in the future for a delay", () => {
    expect(advance(at(0), { kind: "wait", ms: 5000 })).toMatchObject({ status: "queued", cursor: 1, delayMs: 5000 });
  });

  it("keeps the run open when the last step is a delay", () => {
    expect(advance(at(2), { kind: "wait", ms: 1000 })).toMatchObject({ status: "queued", cursor: 3, delayMs: 1000 });
  });

  it("stops the run when a filter does not pass", () => {
    expect(advance(at(1), { kind: "stop" })).toMatchObject({ status: "stopped", cursor: 1, stepStatus: "stopped" });
  });

  it("retries a retryable error on the same step with backoff", () => {
    const next = advance(at(1, 1), { kind: "error", retryable: true, message: "503" });
    expect(next).toMatchObject({ status: "queued", cursor: 1, attempt: 2, error: "503", stepStatus: "retrying" });
    expect(next.delayMs).toBe(backoffMs(1));
  });

  it("fails once the attempts are used up", () => {
    const next = advance(at(1, MAX_ATTEMPTS), { kind: "error", retryable: true, message: "503" });
    expect(next).toMatchObject({ status: "failed", cursor: 1, attempt: MAX_ATTEMPTS, stepStatus: "failed" });
  });

  it("fails immediately on an error that retrying cannot fix", () => {
    const next = advance(at(0, 1), { kind: "error", retryable: false, message: "404" });
    expect(next).toMatchObject({ status: "failed", error: "404", delayMs: 0 });
  });
});

describe("backoffMs", () => {
  it("doubles each attempt up to a cap", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([2000, 4000, 8000, 16000]);
    expect(backoffMs(20)).toBe(60000);
  });
});

describe("evaluate", () => {
  it("compares as text for equality", () => {
    expect(evaluate(200, "equals", "200")).toBe(true);
    expect(evaluate("pro", "not_equals", "free")).toBe(true);
    expect(evaluate(null, "equals", "")).toBe(true);
  });

  it("checks containment in text and arrays", () => {
    expect(evaluate("ada@example.com", "contains", "@")).toBe(true);
    expect(evaluate(["a", "b"], "contains", "b")).toBe(true);
    expect(evaluate(["ab"], "contains", "a")).toBe(false);
  });

  it("compares numbers numerically, not as text", () => {
    expect(evaluate("9", "less_than", "10")).toBe(true);
    expect(evaluate(120000, "greater_than", "100000")).toBe(true);
    expect(evaluate("abc", "greater_than", "1")).toBe(false);
    expect(evaluate("", "less_than", "1")).toBe(false);
  });

  it("treats empty values as missing", () => {
    expect(evaluate("x", "exists", "")).toBe(true);
    expect(evaluate(0, "exists", "")).toBe(true);
    expect(evaluate("", "exists", "")).toBe(false);
    expect(evaluate(null, "exists", "")).toBe(false);
  });
});
