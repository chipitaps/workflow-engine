import { getPool } from "@/db";

export async function GET() {
  try {
    await getPool().query("select 1");
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "database-unreachable" }, { status: 503 });
  }
}
