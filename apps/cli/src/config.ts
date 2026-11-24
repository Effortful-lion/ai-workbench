import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_SERVER = "http://localhost:8700";

export interface CliConfig {
  server: string;
  /** 短期 access token（15 分钟），会自动续期 */
  token?: string;
  /** 长期 refresh token（7 天，服务端可吊销），续期与登出的凭证 */
  refreshToken?: string;
  username?: string;
  role?: string;
  /** `--token` 临时覆盖时不回写磁盘，也不自动续期 */
  noPersist?: boolean;
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
  // 显式挑字段：运行时标记（noPersist）不落盘
  const data: CliConfig = {
    server: cfg.server,
    token: cfg.token,
    refreshToken: cfg.refreshToken,
    username: cfg.username,
    role: cfg.role,
  };
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  // 覆盖已有文件时 mode 不生效，显式收紧权限
  chmodSync(FILE, 0o600);
}

export function clearConfig(): void {
  if (existsSync(FILE)) rmSync(FILE);
}

export function configPath(): string {
  return FILE;
}
