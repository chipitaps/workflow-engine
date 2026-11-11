import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "../src/db";
import { parseDefinition, provision } from "../src/engine/provision";

await migrate(db(), { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");

const directories = (process.env.WORKFLOWS_DIR ?? "")
  .split(",")
  .map((directory) => directory.trim())
  .filter(Boolean);

for (const directory of directories) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const definitions = await Promise.all(
    files.map(async (file) => parseDefinition(await readFile(join(directory, file), "utf8"), process.env, file)),
  );
  const count = await provision(db(), definitions);
  console.log(`Provisioned ${count} workflow(s) from ${directory}.`);
}

await closeDb();
