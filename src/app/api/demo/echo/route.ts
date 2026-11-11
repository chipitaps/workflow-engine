export async function POST(request: Request) {
  const text = (await request.text()).slice(0, 8192);
  let received: unknown = text;
  try {
    received = JSON.parse(text);
  } catch {
    received = text;
  }
  return Response.json({ ok: true, received, receivedAt: new Date().toISOString() });
}
