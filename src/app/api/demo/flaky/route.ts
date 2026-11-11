const FAILURES_BEFORE_SUCCESS = 2;
const MAX_TRACKED = 500;

const globalForDemo = globalThis as typeof globalThis & { __engineFlaky?: Map<string, number> };
const seen = (globalForDemo.__engineFlaky ??= new Map<string, number>());

export async function GET(request: Request) {
  const key = request.headers.get("idempotency-key") ?? "anonymous";
  const calls = (seen.get(key) ?? 0) + 1;
  seen.set(key, calls);
  if (seen.size > MAX_TRACKED) seen.delete(seen.keys().next().value as string);

  if (calls <= FAILURES_BEFORE_SUCCESS) {
    return Response.json({ error: "Service temporarily unavailable", call: calls }, { status: 503 });
  }
  seen.delete(key);
  return Response.json({ message: `Answered on call ${calls}`, call: calls });
}
