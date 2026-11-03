#!/usr/bin/env node
import {
  OPERATIONS,
  findOperation,
  mimeOfFileName,
  operationModules,
  operationsOfModule,
  type OperationDef,
  type OperationParam,
} from "@aiwb/shared";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs, str } from "./args.js";
import { clearConfig, configPath, DEFAULT_SERVER, loadConfig, saveConfig } from "./config.js";
import { ApiError, callApi } from "./http.js";

const VERSION = "0.1.0";

/** 全局 flag，不参与操作参数解析 */
const GLOBAL_FLAGS = new Set([
  "server",
  "token",
  "raw",
  "quiet",
  "yes",
  "help",
  "data",
  "module",
  "username",
  "password",
]);

type Flags = Record<string, string | boolean>;

const flagsOf = (flags: Flags) => ({
  raw: flags.raw === true,
  quiet: flags.quiet === true,
  yes: flags.yes === true,
});

function usageErr(message: string): never {
  console.error(message);
  console.error("  → aiwb help 查看全部命令");
  process.exit(2);
}

function printJson(data: unknown, flags: Flags): void {
  if (flags.quiet === true) return;
  if (data === null || data === undefined) {
    console.log("✓ ok");
    return;
  }
  console.log(flags.raw === true ? JSON.stringify(data) : JSON.stringify(data, null, 2));
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : `${s}${" ".repeat(n - s.length)}`;
}

function printHelp(): void {
  const modules = operationModules();
  console.log(`aiwb ${VERSION} — AI 工作台终端客户端

用法:
  aiwb login --username <账号> --password <密码> [--server <地址>]
  aiwb <模块> <操作> [--参数…]
  aiwb <模块.操作> [--参数…]
  aiwb call <METHOD> <path> [--data '<json>']   # 兜底：任意接口
  aiwb operations [--module <模块>]             # 操作目录
  aiwb whoami | logout | version

模块:
${modules.map((m) => `  ${pad(m, 8)} ${operationsOfModule(m).length} 个操作`).join("\n")}

全局参数:
  --server <url>   后端地址（默认 ${DEFAULT_SERVER}）
  --token <jwt>    临时覆盖凭证
  --data <json>    追加/覆盖请求体
  --yes            确认不可逆操作（delete 类）
  --raw            单行 JSON 输出
  --quiet          静默成功输出
  -h, --help       帮助

示例:
  aiwb login --username admin --password admin
  aiwb mail messages.list --folder inbox --unread
  aiwb mail messages.get --id <邮件ID>
  aiwb mail sync
  aiwb mail accounts.list`);
}

function printModule(module: string): void {
  const ops = operationsOfModule(module);
  if (!ops.length) usageErr(`没有模块 ${module}（可用：${operationModules().join(", ")}）`);
  console.log(`${module} 操作：`);
  const width = Math.max(...ops.map((o) => o.key.length)) + 2;
  for (const op of ops) {
    const tag = op.risk === "read" ? " " : op.risk === "write" ? "✎" : "!";
    console.log(`  ${tag} ${pad(op.key, width)} ${op.summary}`);
  }
  console.log(`\n详细参数：aiwb help ${ops[0].key}`);
}

function printOperation(op: OperationDef): void {
  console.log(`${op.key} — ${op.summary}
  ${op.method} /api${op.path}${op.permission ? `   权限 ${op.permission}` : ""}
${op.risk === "destructive" ? "  ⚠ 不可逆操作，需加 --yes\n" : ""}${
    op.params?.length
      ? `参数:\n${op.params
          .map((p) => {
            const type = p.type === "boolean" ? "" : ` <${p.type}>`;
            const req = p.required ? " *必填" : "";
            const loc = p.in === "path" ? "路径" : p.in === "query" ? "查询" : p.in === "file" ? "文件" : "请求体";
            return `  --${p.name.replace(/([A-Z])/g, "-$1").toLowerCase()}${type}  ${loc}${req}  ${p.desc ?? ""}`.trimEnd();
          })
          .join("\n")}`
      : "无参数"
  }`);
}

function coerce(p: OperationParam, raw: string | boolean): unknown {
  if (p.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
  }
  if (p.type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) usageErr(`--${p.name} 需要数字，收到 ${String(raw)}`);
    return n;
  }
  if (p.type === "json") {
    try {
      return JSON.parse(String(raw));
    } catch {
      usageErr(`--${p.name} 需要合法 JSON`);
    }
  }
  return String(raw);
}

/** 上传文件上限，与服务端 toolbox 一致 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

interface UploadFilePart {
  field: string;
  buffer: Buffer;
  name: string;
}

/** CLI 侧上传：--file 支持相对路径（按当前目录解析），读盘后作为 multipart 文件字段 */
function readUploadFile(field: string, filePath: string): UploadFilePart {
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(filePath);
  } catch {
    throw new Error(`读取文件失败：${filePath}（不存在或无权访问）`);
  }
  if (!info.isFile()) throw new Error(`不是普通文件：${filePath}`);
  if (info.size > MAX_UPLOAD_BYTES) {
    throw new Error(`文件过大：${(info.size / 1024 / 1024).toFixed(1)}MB，上限 50MB`);
  }
  return { field, buffer: readFileSync(filePath), name: basename(filePath) };
}

/** 文本类文件参数（kb / 项目文档 / 代码文件）默认上限 */
const MAX_TEXT_BYTES = 4 * 1024 * 1024;

/** 读本机纯文本文件，内容直接作为 body 字段的值 */
function readTextFile(filePath: string, maxBytes: number): string {
  if (/\.(pdf|docx|doc)$/i.test(filePath)) {
    throw new Error(`CLI 暂不支持二进制文档（${filePath}），请用 aiwb resume.import 或直接粘贴文本`);
  }
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(filePath);
  } catch {
    throw new Error(`读取文件失败：${filePath}（不存在或无权访问）`);
  }
  if (!info.isFile()) throw new Error(`不是普通文件：${filePath}`);
  if (info.size > maxBytes) {
    throw new Error(`文件过大：${(info.size / 1024 / 1024).toFixed(1)}MB，上限 ${maxBytes / 1024 / 1024}MB`);
  }
  const text = readFileSync(filePath, "utf8");
  if (!text.trim()) throw new Error(`文件内容为空：${filePath}`);
  return text;
}

function resolveOperation(positionals: string[]): { op: OperationDef } | { module: string } | null {
  const [first, second] = positionals;
  if (!first) return null;
  if (first.includes(".")) {
    const op = findOperation(first);
    return op ? { op } : null;
  }
  if (!second) return { module: first };
  const op = findOperation(`${first}.${second}`);
  return op ? { op } : null;
}

async function runOperation(op: OperationDef, flags: Flags): Promise<number> {
  const cfg = loadConfig();
  if (str(flags, "server")) cfg.server = str(flags, "server") as string;
  if (str(flags, "token")) cfg.token = str(flags, "token") as string;
  if (!cfg.token) usageErr("尚未登录：先执行 aiwb login --username <账号> --password <密码>");

  let path = op.path;
  const query: Record<string, unknown> = {};
  const body: Record<string, unknown> = {};
  const files: UploadFilePart[] = [];

  for (const p of op.params ?? []) {
    let raw = flags[p.name];
    if (raw === undefined && p.default !== undefined) raw = p.default as string | boolean;
    if (raw === undefined) {
      if (p.required) usageErr(`缺少 --${p.name.replace(/([A-Z])/g, "-$1").toLowerCase()}（${p.desc ?? p.name}）`);
      continue;
    }
    const value = coerce(p, raw);
    if (p.in === "path") path = path.replace(`:${p.name}`, encodeURIComponent(String(value)));
    else if (p.in === "query") query[p.name] = value;
    else if (p.in === "file") {
      // 带 target = 读文本填 body 字段；否则按 multipart 文件上传
      if (p.target) body[p.target] = readTextFile(String(value), p.maxBytes ?? MAX_TEXT_BYTES);
      else files.push(readUploadFile(p.name, String(value)));
    } else body[p.name] = value;
  }

  // file 与文本字段都为空时提前报错（CLI 侧只是提示，最终仍由服务端校验）
  for (const p of op.params ?? []) {
    if (p.in !== "file" || !p.target) continue;
    if (flags[p.name] === undefined && body[p.target] === undefined) {
      usageErr(
        `${op.key} 需要 --${p.name.replace(/([A-Z])/g, "-$1").toLowerCase()} 或 --${p.target.replace(/([A-Z])/g, "-$1").toLowerCase()}（二选一）`,
      );
    }
  }

  // 目录里没声明的参数：GET 归查询，其余归请求体——接口先行扩展时 CLI 不用改
  for (const [k, v] of Object.entries(flags)) {
    if (GLOBAL_FLAGS.has(k)) continue;
    if ((op.params ?? []).some((p) => p.name === k)) continue;
    if (op.method === "GET") query[k] = v;
    else body[k] = v;
  }

  if (typeof flags.data === "string") {
    try {
      Object.assign(body, JSON.parse(flags.data));
    } catch {
      usageErr("--data 需要合法 JSON");
    }
  }

  if (op.risk === "destructive" && !flagsOf(flags).yes) {
    usageErr(`${op.key} 不可逆，确认要执行请加 --yes`);
  }
  if (path.includes(":")) usageErr(`路径参数未填全：${path}`);

  const hasBody = Object.keys(body).length > 0;

  // 有文件参数 → multipart；其余字段转成表单字符串
  let form: FormData | undefined;
  if (files.length) {
    form = new FormData();
    for (const f of files) {
      form.append(f.field, new Blob([Uint8Array.from(f.buffer)], { type: mimeOfFileName(f.name) }), f.name);
    }
    for (const [k, v] of Object.entries(body)) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }

  const data = await callApi(cfg, op.method, path, {
    query,
    ...(form
      ? { form }
      : { body: op.method === "GET" || op.method === "DELETE" ? undefined : hasBody ? body : undefined }),
  });
  printJson(data, flags);
  return 0;
}

async function main(): Promise<void> {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const [first] = positionals;

  if (flags.help === true && first) {
    const resolved = resolveOperation(positionals);
    if (resolved && "op" in resolved) {
      printOperation(resolved.op);
      return;
    }
    if (resolved && "module" in resolved) {
      printModule(resolved.module);
      return;
    }
  }
  if (!first) {
    printHelp();
    return;
  }

  const cfg = loadConfig();
  if (str(flags, "server")) cfg.server = str(flags, "server") as string;

  switch (first) {
    case "help": {
      const target = positionals[1];
      if (!target) {
        printHelp();
        return;
      }
      const op = findOperation(target);
      if (op) printOperation(op);
      else printModule(target);
      return;
    }
    case "version":
      console.log(`aiwb ${VERSION}`);
      return;
    case "login": {
      const username = str(flags, "username") ?? process.env.AIWB_USERNAME ?? "";
      const password = str(flags, "password") ?? process.env.AIWB_PASSWORD ?? "";
      if (!username || !password) usageErr("用法：aiwb login --username <账号> --password <密码>");
      const data = (await callApi({ server: cfg.server }, "POST", "/auth/login", {
        body: { username, password },
      })) as { user?: { username?: string; role?: string }; tokens?: { accessToken?: string } };
      const token = data.tokens?.accessToken;
      if (!token) throw new ApiError("登录响应缺少 accessToken", 500);
      saveConfig({
        server: cfg.server,
        token,
        username: data.user?.username,
        role: data.user?.role,
      });
      if (flags.quiet !== true) {
        console.log(`✓ 已登录 ${data.user?.username ?? username} (${data.user?.role ?? "?"}) · ${cfg.server}`);
        console.log(`  凭证已写入 ${configPath()}`);
      }
      return;
    }
    case "logout": {
      clearConfig();
      if (flags.quiet !== true) console.log("✓ 已退出登录");
      return;
    }
    case "whoami": {
      if (!cfg.token) usageErr("尚未登录：先执行 aiwb login");
      printJson(await callApi(cfg, "GET", "/auth/me"), flags);
      return;
    }
    case "operations": {
      const module = str(flags, "module");
      const ops = module ? operationsOfModule(module) : OPERATIONS;
      if (!ops.length) usageErr(`没有模块 ${module}`);
      if (flags.raw === true || flags.quiet === true) {
        printJson(ops, flags);
        return;
      }
      const width = Math.max(...ops.map((o) => o.key.length)) + 2;
      for (const op of ops) {
        const tag = op.risk === "read" ? " " : op.risk === "write" ? "✎" : "!";
        console.log(`${tag} ${pad(op.key, width)} ${op.summary}`);
      }
      return;
    }
    case "call": {
      const [, rawMethod, rawPath] = positionals;
      if (!rawMethod || !rawPath) {
        usageErr("用法：aiwb call <GET|POST|PATCH|DELETE> <path> [--data '<json>']");
      }
      const method = rawMethod.toUpperCase();
      let body: unknown;
      if (typeof flags.data === "string") {
        try {
          body = JSON.parse(flags.data);
        } catch {
          usageErr("--data 需要合法 JSON");
        }
      }
      if (!cfg.token) usageErr("尚未登录：先执行 aiwb login");
      printJson(await callApi(cfg, method, rawPath, { body }), flags);
      return;
    }
    default: {
      const resolved = resolveOperation(positionals);
      if (!resolved) {
        usageErr(`未知命令：${positionals.join(" ")}（aiwb help 查看可用命令）`);
      }
      if ("module" in resolved) {
        printModule(resolved.module);
        return;
      }
      process.exitCode = await runOperation(resolved.op, flags);
    }
  }
}

main().catch((e: unknown) => {
  if (e instanceof ApiError) {
    const hint = e.status === 401 ? "（凭证失效，请重新 aiwb login）" : e.status === 403 ? "（当前账号无此权限）" : "";
    console.error(`✗ ${e.message}${hint}`);
    process.exit(1);
  }
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
