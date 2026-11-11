export const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;

export function backoffMs(attempt: number) {
  return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
}

export type Outcome =
  | { kind: "ok" }
  | { kind: "wait"; ms: number }
  | { kind: "stop" }
  | { kind: "error"; retryable: boolean; message: string };

export type Position = { cursor: number; attempt: number; totalSteps: number };

export type Transition = {
  status: "queued" | "succeeded" | "failed" | "stopped";
  cursor: number;
  attempt: number;
  delayMs: number;
  error: string | null;
  stepStatus: "succeeded" | "failed" | "retrying" | "stopped";
};

export function advance(position: Position, outcome: Outcome, maxAttempts = MAX_ATTEMPTS): Transition {
  const { cursor, attempt, totalSteps } = position;

  if (outcome.kind === "stop") {
    return { status: "stopped", cursor, attempt, delayMs: 0, error: null, stepStatus: "stopped" };
  }

  if (outcome.kind === "error") {
    if (outcome.retryable && attempt < maxAttempts) {
      return {
        status: "queued",
        cursor,
        attempt: attempt + 1,
        delayMs: backoffMs(attempt),
        error: outcome.message,
        stepStatus: "retrying",
      };
    }
    return { status: "failed", cursor, attempt, delayMs: 0, error: outcome.message, stepStatus: "failed" };
  }

  const next = cursor + 1;
  const delayMs = outcome.kind === "wait" ? outcome.ms : 0;
  if (next >= totalSteps && delayMs === 0) {
    return { status: "succeeded", cursor: next, attempt: 1, delayMs: 0, error: null, stepStatus: "succeeded" };
  }
  return { status: "queued", cursor: next, attempt: 1, delayMs, error: null, stepStatus: "succeeded" };
}
