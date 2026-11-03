import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { extractTextFromBuffer } from "../common/file-text";
import {
  findOperation,
  mimeOfFileName,
  operationToolSchemas,
  type OperationDef,
  type ToolContext,
  type ToolDef,
} from "@aiwb/shared";
import { ToolRegistry } from "./tool-registry.service";

/** 目录工具单次调用超时：mail.sync / 简历解析等可能跑很久 */
const CALL_TIMEOUT_MS = 120_000;

/** 上传文件读取上限，与 toolbox 的 50MB 对齐；更小的接口上限由 Controller 再拦一次 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** 文本类文件参数（读内容进 body）默认上限 */
const MAX_TEXT_BYTES = 4 * 1024 * 1024;

/** 把操作目录注册成 AI 工具：执行时以当前用户身份回打本机 HTTP API。
 *  这样 Controller 的校验/权限/副作用与 CLI 完全同一条链路，工具层不再重写业务。 */
@Injectable()
export class OperationToolsService implements OnModuleInit {
  private readonly log = new Logger("operation-tools");
  private readonly baseUrl = `http://127.0.0.1:${Number(process.env.PORT ?? 8700)}/api`;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly jwt: JwtService,
  ) {}

  onModuleInit(): void {
    const schemas = operationToolSchemas();
    for (const schema of schemas) {
      const op = findOperation(schema.name);
      if (!op) continue;
      const tool: ToolDef = {
        ...schema,
        handler: (ctx, args) => this.callOperation(ctx, op, args),
      };
      this.registry.register(tool);
    }
    this.log.log(`registered ${schemas.length} operation tools from catalog`);
  }

  private async callOperation(
    ctx: ToolContext,
    op: OperationDef,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const { path, query, body, files, textFiles, pathMissing } = buildRequest(op, args);
    if (pathMissing) throw new Error(`路径参数未填全：${pathMissing}`);

    // file 与文本字段都为空时提前报错，避免把空内容发进接口
    for (const p of op.params ?? []) {
      if (p.in !== "file" || !p.target) continue;
      const given = args[p.name];
      if ((given === undefined || given === null || given === "") && body[p.target] === undefined) {
        throw new Error(`${op.key} 需要 ${p.name} 或 ${p.target}（二选一）`);
      }
    }

    // 文本类文件参数（kb / 项目文档 / 代码文件）：读出文本填进 body 字段
    for (const f of textFiles) {
      body[f.target] = await readTextFile(f.path, f.maxBytes);
    }

    // 以当前用户身份签发一次性 token（沿用同一套 guard / 权限判定）
    const token = await this.jwt.signAsync(
      { sub: ctx.userId, username: ctx.username ?? "api", role: ctx.role },
      { expiresIn: "2m" },
    );

    const qs = query.toString();
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    };

    // 有文件参数 → multipart：文件读成 Blob，其余字段按表单字符串提交
    let payload: FormData | string | undefined;
    if (files.length) {
      const form = new FormData();
      for (const f of files) {
        const file = await readUploadFile(f.path);
        form.append(f.name, new Blob([Uint8Array.from(file.buffer)], { type: file.type }), file.name);
      }
      for (const [key, value] of Object.entries(body)) {
        form.append(key, bodyValue(value));
      }
      payload = form; // content-type 交给 fetch 自动带 boundary
    } else if (Object.keys(body).length > 0) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: op.method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(`调用 ${op.key} 失败：${e instanceof Error ? e.message : String(e)}`);
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new Error(errorMessage(data) ?? `${res.status} ${res.statusText}`);
    // 列表类结果压一下超长正文，避免整篇内容灌进模型上下文
    return op.action.endsWith(".list") ? shrinkListPayload(data) : data;
  }
}

/** 列表结果里单条字符串的保留上限；列表页只需预览，详情请用 *.get */
const MAX_LIST_STRING = 800;

function shrinkListPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === "string") {
    return value.length > MAX_LIST_STRING ? `${value.slice(0, MAX_LIST_STRING)}…(已截断)` : value;
  }
  if (Array.isArray(value)) return value.map((v) => shrinkListPayload(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = shrinkListPayload(v, depth + 1);
    return out;
  }
  return value;
}

/** 按目录参数把 AI 传的 args 拆成 path / query / body / files（未知参数按方法归位，接口先行扩展也能用） */
function buildRequest(op: OperationDef, args: Record<string, unknown>) {
  let path = op.path;
  const query = new URLSearchParams();
  const body: Record<string, unknown> = {};
  const files: { name: string; path: string }[] = [];
  const textFiles: { path: string; target: string; maxBytes: number }[] = [];
  const declared = new Set((op.params ?? []).map((p) => p.name));

  for (const p of op.params ?? []) {
    const value = args[p.name];
    if (value === undefined || value === null || value === "") continue;
    if (p.in === "path") {
      path = path.replace(new RegExp(`:${p.name}(?=/|$)`), encodeURIComponent(String(value)));
    } else if (p.in === "query") {
      query.set(p.name, queryValue(value));
    } else if (p.in === "file") {
      // 带 target = 读文本填 body 字段；否则按 multipart 文件上传
      if (p.target) {
        textFiles.push({ path: String(value), target: p.target, maxBytes: p.maxBytes ?? MAX_TEXT_BYTES });
      } else {
        files.push({ name: p.name, path: String(value) });
      }
    } else {
      body[p.name] = value;
    }
  }

  for (const [key, value] of Object.entries(args)) {
    if (declared.has(key) || value === undefined || value === null) continue;
    if (op.method === "GET" || op.method === "DELETE") query.set(key, queryValue(value));
    else body[key] = value;
  }

  return {
    path,
    query,
    body,
    files,
    textFiles,
    pathMissing: /:\w+/.test(path) ? path : null,
  };
}

/** 读本机文件用于上传：只接受绝对路径，拒绝隐藏文件（.ssh/.env 等）与超大文件 */
async function readUploadFile(filePath: string) {
  const { abs, info } = await localFile(filePath);
  if (info.size > MAX_UPLOAD_BYTES) {
    throw new Error(`文件过大：${(info.size / 1024 / 1024).toFixed(1)}MB，上限 50MB`);
  }
  return {
    buffer: await readFile(abs),
    name: basename(abs),
    type: mimeOfFileName(basename(abs)),
  };
}

/** 读本机纯文本文件，内容写进 body 字段（kb 入库 / 项目文档 / 代码文件）；
 *  pdf/docx 复用通用抽取，其余按 UTF-8 读 */
async function readTextFile(filePath: string, maxBytes: number): Promise<string> {
  const { abs, info } = await localFile(filePath);
  if (info.size > maxBytes) {
    throw new Error(`文件过大：${(info.size / 1024 / 1024).toFixed(1)}MB，上限 ${maxBytes / 1024 / 1024}MB`);
  }
  const buffer = await readFile(abs);
  const ext = extname(abs).toLowerCase();
  const text =
    ext === ".pdf" || ext === ".docx"
      ? (await extractTextFromBuffer(buffer, basename(abs))).text
      : buffer.toString("utf8");
  if (!text.trim()) throw new Error(`文件内容为空：${abs}`);
  return text;
}

/** 统一的本机文件校验：绝对路径 + realpath + 拒绝 dotfile + 必须是普通文件 */
async function localFile(filePath: string) {
  if (!isAbsolute(filePath)) throw new Error(`文件参数只接受本机绝对路径：${filePath}`);
  let abs: string;
  try {
    abs = await realpath(filePath);
  } catch {
    throw new Error(`读取文件失败：${filePath}（不存在或无权访问）`);
  }
  if (abs.split("/").some((seg) => seg.startsWith("."))) {
    throw new Error(`拒绝读取隐藏文件：${abs}`);
  }
  const info = await stat(abs);
  if (!info.isFile()) throw new Error(`不是普通文件：${abs}`);
  return { abs, info };
}

/** multipart 表单字段：对象 / 数组转 JSON，其余转字符串 */
function bodyValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function queryValue(value: unknown): string {
  return typeof value === "boolean" ? (value ? "1" : "0") : String(value);
}

function errorMessage(data: unknown): string | null {
  if (typeof data === "string") return data.slice(0, 300);
  if (!data || typeof data !== "object") return null;
  const message = (data as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join("; ");
  return typeof message === "string" ? message : null;
}
