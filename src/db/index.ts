import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as typeof globalThis & { __engineDb?: Database; __enginePool?: Pool };

export function getPool() {
  if (!globalForDb.__enginePool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set.");
    globalForDb.__enginePool = new Pool({ connectionString, max: 10 });
  }
  return globalForDb.__enginePool;
}

export function db(): Database {
  if (!globalForDb.__engineDb) {
    globalForDb.__engineDb = drizzle(getPool(), { schema });
  }
  return globalForDb.__engineDb;
}

export async function closeDb() {
  await globalForDb.__enginePool?.end();
  globalForDb.__enginePool = undefined;
  globalForDb.__engineDb = undefined;
}
