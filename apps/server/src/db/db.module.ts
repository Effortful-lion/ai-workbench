import { Global, Module } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export const DB = Symbol("DB");
export type Db = ReturnType<typeof createDb>;

/** workspace root — 从 __dirname 上溯，不依赖 cwd。
 *  编译后 __dirname = apps/server/dist/db，往上 4 级即 workspace root。 */
function workspaceRoot(): string {
  // db.module.ts → dist/db → dist → server → apps → workspace root
  return resolve(__dirname, "../../../..");
}

function createDb() {
  const dir = resolve(workspaceRoot(), "data");
  mkdirSync(dir, { recursive: true });
  const sqlite = new Database(resolve(dir, "workbench.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

@Global()
@Module({
  providers: [{ provide: DB, useFactory: createDb }],
  exports: [DB],
})
export class DbModule {}
