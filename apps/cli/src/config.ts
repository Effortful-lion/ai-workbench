import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_SERVER = "http://localhost:8700";

export interface CliConfig {
  server: string;
  token?: string;
  username?: string;
  role?: string;
}

const DIR = join(homedir(), ".aiwb");
const FILE = join(DIR, "config.json");

export function loadConfig(): CliConfig {
  if (!existsSync(FILE)) return { server: DEFAULT_SERVER };
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Partial<CliConfig>;
    return { server: raw.server || DEFAULT_SERVER, ...raw };
  } catch {
    return { server: DEFAULT_SERVER };
  }
}

export function saveConfig(cfg: CliConfig): void {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
}

export function clearConfig(): void {
  if (existsSync(FILE)) rmSync(FILE);
}

export function configPath(): string {
  return FILE;
}
