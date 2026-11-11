import { evaluate } from "./conditions";
import { assertAllowedUrl, policyFromEnv, StepError, type NetworkPolicy } from "./network";
import type { Outcome } from "./state";
import { render, resolve } from "./template";
import type { Context, HttpStep, Step } from "./types";

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

export type StepResult = { outcome: Outcome; input: unknown; output: unknown };

export type Dependencies = {
  policy?: NetworkPolicy;
  fetch?: typeof fetch;
};

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new StepError(`The response is larger than ${MAX_RESPONSE_BYTES / 1024} KB.`, false);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const SENSITIVE_HEADER = /authorization|cookie|token|secret|key|password|signature/i;
const KEPT_VISIBLE = new Set(["idempotency-key"]);

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER.test(name) && !KEPT_VISIBLE.has(name) ? "[redacted]" : value,
    ]),
  );
}

async function runHttp(step: HttpStep, context: Context, deps: Dependencies) {
  const policy = deps.policy ?? policyFromEnv();
  const send = deps.fetch ?? fetch;
  const headers: Record<string, string> = { "user-agent": "workflow-engine/0.1" };
  for (const [name, value] of Object.entries(step.headers)) headers[name.toLowerCase()] = render(value, context);
  const hasBody = step.method !== "GET" && step.body.trim() !== "";
  const body = hasBody ? render(step.body, context) : undefined;
  if (hasBody && !headers["content-type"]) headers["content-type"] = "application/json";
  headers["idempotency-key"] = `${context.run.id}:${step.id}`;

  let target = render(step.url, context);
  const input = { method: step.method, url: target, headers: redactHeaders(headers), body };

  let response: Response | undefined;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const url = await assertAllowedUrl(target, policy);
      response = await send(url, {
        method: step.method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) break;
      if (hop === MAX_REDIRECTS) throw new StepError("Too many redirects.", false);
      target = new URL(location, url).toString();
    }
  } catch (error) {
    if (error instanceof StepError) throw Object.assign(error, { input });
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "failed";
    throw Object.assign(new StepError(`The request ${reason}.`, true), { input });
  }
  if (!response) throw new StepError("The request produced no response.", true);

  const text = await readLimited(response);
  const type = response.headers.get("content-type") ?? "";
  let parsed: unknown = text;
  if (type.includes("json")) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  const output = { status: response.status, contentType: type, body: parsed };

  if (response.status >= 400) {
    const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
    throw Object.assign(new StepError(`The server answered ${response.status}.`, retryable, output), { input });
  }
  return { input, output };
}

export async function executeStep(step: Step, context: Context, deps: Dependencies = {}): Promise<StepResult> {
  try {
    switch (step.type) {
      case "http": {
        const { input, output } = await runHttp(step, context, deps);
        return { outcome: { kind: "ok" }, input, output };
      }
      case "transform": {
        const output = Object.fromEntries(
          Object.entries(step.values).map(([key, value]) => [key, resolve(value, context)]),
        );
        return { outcome: { kind: "ok" }, input: step.values, output };
      }
      case "filter": {
        const left = resolve(step.left, context);
        const right = resolve(step.right, context);
        const passed = evaluate(left, step.operator, right);
        return {
          outcome: passed ? { kind: "ok" } : { kind: "stop" },
          input: { left, operator: step.operator, right },
          output: { passed },
        };
      }
      case "delay":
        return {
          outcome: { kind: "wait", ms: step.seconds * 1000 },
          input: { seconds: step.seconds },
          output: { waitedSeconds: step.seconds },
        };
    }
  } catch (error) {
    const known = error instanceof StepError;
    const message = known ? error.message : "The step crashed unexpectedly.";
    return {
      outcome: { kind: "error", retryable: known ? error.retryable : true, message },
      input: (error as { input?: unknown }).input ?? null,
      output: known ? (error.output ?? null) : null,
    };
  }
}
