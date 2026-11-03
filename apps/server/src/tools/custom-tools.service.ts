import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type {
  CustomToolDto,
  HttpToolSpec,
  ToolContext,
  ToolDef,
  UpsertCustomToolInput,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { customTools } from "../db/schema";
import { ToolRegistry } from "./tool-registry.service";
import { RegisterTool } from "./register-tool.decorator";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
const TPL_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 256 * 1024;

type Row = typeof customTools.$inferSelect;

/** 自定义工具：声明式 HTTP 工具的持久化 + 执行 + 注册生命周期。
 *  human-in-the-loop：AI 创建的一律 enabled=false，人工启用后才进 ToolRegistry。 */
@Injectable()
export class CustomToolsService implements OnModuleInit {
  private readonly log = new Logger("custom-tools");

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: ToolRegistry,
  ) {}

  async onModuleInit() {
    const rows = await this.db.select().from(customTools).where(eq(customTools.enabled, true));
    for (const row of rows) this.registry.register(this.toToolDef(row));
    if (rows.length) this.log.log(`loaded ${rows.length} enabled custom tools`);
  }

  // ---------- meta 工具：让 AI 在聊天里自写工具 ----------

  @RegisterTool({
    name: "tools.create",
    description:
      "创建自定义 HTTP 工具（AI 自写工具）。url/headers/bodyTemplate 支持 {{参数名}} 模板占位。创建后默认停用，需用户在「工具管理」面板(/aitools)手动启用后才能被 Agent 调用。",
    permission: "tools:write",
    argsSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "工具名，小写字母/数字/中划线，可省略 custom. 前缀" },
        description: { type: "string", description: "一句话说明工具用途" },
        url: { type: "string", description: "请求地址，支持 {{参数}} 占位" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], description: "缺省 GET" },
        headers: { type: "object", description: "请求头，值支持 {{参数}} 占位" },
        bodyTemplate: { type: "string", description: "POST/PUT 请求体模板，支持 {{参数}} 占位" },
        argsSchema: { type: "object", description: "参数 JSON Schema（type:object, properties, required）" },
      },
      required: ["name", "description", "url"],
    },
  })
  async createViaAi(ctx: ToolContext, args: Record<string, unknown>) {
    const input: UpsertCustomToolInput = {
      name: String(args.name ?? ""),
      description: String(args.description ?? ""),
      url: String(args.url ?? ""),
      method: args.method as HttpToolSpec["method"],
      headers: args.headers as Record<string, string> | undefined,
      bodyTemplate: args.bodyTemplate as string | undefined,
      argsSchema: args.argsSchema as Record<string, unknown> | undefined,
    };
    const dto = await this.create(ctx.userId, input, "ai", false);
    return {
      ...dto,
      hint: `工具 ${dto.name} 已创建但处于停用状态。请提醒用户打开「工具管理」面板（/aitools）手动启用后，Agent 才能调用它。`,
    };
  }

  @RegisterTool({
    name: "tools.list",
    description: "列出当前用户的自定义工具（含启用状态、创建来源）",
    permission: "tools:read",
  })
  async listViaAi(ctx: ToolContext) {
    return this.listMine(ctx.userId);
  }

  // ---------- REST / 面板 ----------

  async listMine(ownerId: string): Promise<CustomToolDto[]> {
    const rows = await this.db.select().from(customTools).where(eq(customTools.ownerId, ownerId));
    return rows.map((r) => this.toDto(r));
  }

  async create(
    ownerId: string,
    input: UpsertCustomToolInput,
    createdBy: "ai" | "user",
    enabled: boolean,
  ): Promise<CustomToolDto> {
    const name = this.normalizeName(input.name);
    await this.assertNameAvailable(name);
    const spec = this.buildSpec(input);
    const row: Row = {
      id: randomUUID(),
      ownerId,
      name,
      description: (input.description ?? "").slice(0, 500),
      kind: "http",
      specJson: spec,
      argsSchemaJson: input.argsSchema ?? null,
      enabled,
      createdBy,
      createdAt: new Date(),
    };
    await this.db.insert(customTools).values(row);
    if (enabled) this.registry.register(this.toToolDef(row));
    return this.toDto(row);
  }

  async update(ownerId: string, id: string, input: UpsertCustomToolInput): Promise<CustomToolDto> {
    const row = await this.getOwned(ownerId, id);
    const name = this.normalizeName(input.name);
    if (name !== row.name) await this.assertNameAvailable(name);
    const spec = this.buildSpec(input);
    this.registry.unregister(row.name);
    const next: Row = {
      ...row,
      name,
      description: (input.description ?? "").slice(0, 500),
      specJson: spec,
      argsSchemaJson: input.argsSchema ?? null,
    };
    await this.db.update(customTools)
      .set({
        name,
        description: next.description,
        specJson: spec,
        argsSchemaJson: next.argsSchemaJson,
      })
      .where(eq(customTools.id, id));
    if (next.enabled) this.registry.register(this.toToolDef(next));
    return this.toDto(next);
  }

  async toggle(ownerId: string, id: string): Promise<CustomToolDto> {
    const row = await this.getOwned(ownerId, id);
    const next: Row = { ...row, enabled: !row.enabled };
    await this.db.update(customTools).set({ enabled: next.enabled }).where(eq(customTools.id, id));
    if (next.enabled) this.registry.register(this.toToolDef(next));
    else this.registry.unregister(row.name);
    return this.toDto(next);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    const row = await this.getOwned(ownerId, id);
    this.registry.unregister(row.name);
    await this.db.delete(customTools).where(eq(customTools.id, id));
  }

  // ---------- 内部 ----------

  private async getOwned(ownerId: string, id: string): Promise<Row> {
    const rows = await this.db.select().from(customTools).where(eq(customTools.id, id));
    const row = rows[0];
    if (!row) throw new NotFoundException("custom tool not found");
    if (row.ownerId !== ownerId) throw new ForbiddenException("not your tool");
    return row;
  }

  private normalizeName(raw: string): string {
    const slug = (raw ?? "").trim().toLowerCase().replace(/^custom\./, "");
    if (!SLUG_RE.test(slug)) {
      throw new BadRequestException(
        "工具名需为 1-31 位小写字母/数字/中划线，且以字母或数字开头",
      );
    }
    return `custom.${slug}`;
  }

  /** 全局唯一：registry 是进程级单例，跨用户也不能重名 */
  private async assertNameAvailable(name: string) {
    if (this.registry.get(name)) throw new BadRequestException(`工具名已被占用: ${name}`);
    const rows = await this.db.select({ id: customTools.id }).from(customTools)
      .where(eq(customTools.name, name));
    if (rows.length) throw new BadRequestException(`工具名已被占用: ${name}`);
  }

  private buildSpec(input: UpsertCustomToolInput): HttpToolSpec {
    const method = (input.method ?? "GET").toUpperCase() as HttpToolSpec["method"];
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) {
      throw new BadRequestException("method 仅支持 GET/POST/PUT/DELETE");
    }
    const url = (input.url ?? "").trim();
    if (!url) throw new BadRequestException("url 不能为空");
    // 用样例值替换模板占位后做 SSRF 校验；执行时会再校验一次真实渲染结果
    assertSafeUrl(renderTemplate(url, {}, true));
    return {
      method,
      url,
      headers: input.headers,
      bodyTemplate: method === "GET" || method === "DELETE" ? undefined : input.bodyTemplate,
    };
  }

  private toDto(row: Row): CustomToolDto {
    return {
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      description: row.description,
      kind: row.kind,
      spec: row.specJson,
      argsSchema: row.argsSchemaJson,
      enabled: row.enabled,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toToolDef(row: Row): ToolDef {
    const spec = row.specJson;
    return {
      name: row.name,
      description: row.description,
      permission: "tools:custom",
      argsSchema: row.argsSchemaJson ?? undefined,
      kind: row.kind,
      custom: true,
      handler: async (_ctx, args) => execHttpSpec(spec, (args ?? {}) as Record<string, unknown>),
    };
  }
}

/** {{key}} 模板渲染：url 场景 encodeURIComponent，headers/body 原样替换 */
function renderTemplate(tpl: string, args: Record<string, unknown>, encode: boolean): string {
  return tpl.replace(TPL_RE, (_m, key: string) => {
    const v = args[key];
    const s = v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    return encode ? encodeURIComponent(s) : s;
  });
}

const BLOCKED_HOSTNAMES = ["localhost", "0.0.0.0", "::1"];

function isPrivateIp(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** SSRF 防护（MVP）：仅 http/https，拒本机/内网主机名与私网 IP（按字面量判定，不做 DNS 解析） */
function assertSafeUrl(rawUrl: string): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new BadRequestException(`非法 URL: ${rawUrl}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new BadRequestException("仅支持 http/https");
  }
  const host = u.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.includes(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isPrivateIp(host)
  ) {
    throw new BadRequestException(`目标主机被安全策略拒绝: ${host}`);
  }
  return u;
}

/** 执行声明式 HTTP 工具：模板渲染 → SSRF 校验 → 10s 超时 fetch → 256KB 响应截断 */
async function execHttpSpec(spec: HttpToolSpec, args: Record<string, unknown>) {
  const url = renderTemplate(spec.url, args, true);
  assertSafeUrl(url);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec.headers ?? {})) {
    headers[k] = renderTemplate(v, args, false);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: spec.method,
      headers,
      body: spec.bodyTemplate ? renderTemplate(spec.bodyTemplate, args, false) : undefined,
      signal: ctrl.signal,
      // 防重定向到内网：MVP 直接拒绝重定向
      redirect: "error",
    });
    let truncated = false;
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    const contentType = res.headers.get("content-type") ?? "";
    let data: unknown = text;
    if (contentType.includes("json")) {
      try {
        data = JSON.parse(text);
      } catch {
        /* 保留原文 */
      }
    }
    return { status: res.status, truncated, data };
  } finally {
    clearTimeout(timer);
  }
}
