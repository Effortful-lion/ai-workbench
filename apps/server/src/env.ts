/**
 * 载入仓库根目录 .env（网站级配置：ADMIN_USER / ADMIN_PASS / PORT 等）。
 *
 * 必须在任何读取 process.env 的模块之前执行：auth.service / storage.service 的
 * 默认值是在模块加载时求值的，晚于 main() 里再赋值就来不及了。
 * 因此 main.ts 第一条 import 就是它。
 *
 * 规则：已存在的环境变量优先，不覆盖 —— 显式 `ADMIN_PASS=xxx pnpm dev` 仍可临时覆盖。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(__dirname, "../../../.env");

if (existsSync(envFile)) {
  for (const raw of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
