import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { DiscoveryService, Reflector } from "@nestjs/core";
import {
  filterByRole,
  hasPermission,
  type Role,
  type ToolContext,
  type ToolDef,
  type ToolResult,
  type ToolSchemaDto,
} from "@aiwb/shared";
import { TOOL_META, type ToolMeta } from "./register-tool.decorator";

/** Tool Registry · 全架构核心：收集所有 @RegisterTool 方法，按角色过滤、统一执行。
 *  HTTP API 与 AI Tool 共用同一 service 层——人调 API，AI 调 Tool，逻辑只有一份。 */
@Injectable()
export class ToolRegistry implements OnModuleInit {
  private readonly log = new Logger("tools");
  private readonly tools = new Map<string, ToolDef>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit() {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as object | null;
      if (!instance || typeof instance !== "object") continue;
      const proto = Object.getPrototypeOf(instance) as object;
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === "constructor") continue;
        // 用 descriptor 取值，避免触发 getter（Nest 内部 provider 的 getter 在原型上直接访问会抛错）
        const desc = Object.getOwnPropertyDescriptor(proto, key);
        const fn = desc?.value as unknown;
        if (typeof fn !== "function") continue;
        const meta = this.reflector.get<ToolMeta | undefined>(TOOL_META, fn);
        if (!meta) continue;
        this.tools.set(meta.name, {
          ...meta,
          kind: "function",
          handler: (fn as ToolDef["handler"]).bind(instance),
        });
      }
    }
    this.log.log(`registered ${this.tools.size} tools: ${[...this.tools.keys()].join(", ")}`);
  }

  /** 动态注册（操作目录生成的工具走这条路径）；同名工具保留先注册者 */
  register(def: ToolDef): void {
    if (this.tools.has(def.name)) return;
    this.tools.set(def.name, { kind: "function", ...def });
  }

  /** 动态注销：自定义工具停用/删除/改名时从注册表移除 */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** 按角色过滤后的工具 Schema（出网 / 注入 LLM） */
  listForRole(role: Role): ToolSchemaDto[] {
    return filterByRole(role, [...this.tools.values()]).map(
      ({ handler: _handler, ...schema }) => schema,
    );
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  /** 执行工具：权限在这里再校验一次（双保险，agent.tools ⊆ 用户权限之外还有角色兜底） */
  async execute(
    ctx: ToolContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const started = Date.now();
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, tool: name, error: `unknown tool: ${name}` };
    if (!hasPermission(ctx.role, tool.permission)) {
      return { ok: false, tool: name, error: `requires ${tool.permission}`, durationMs: 0 };
    }
    try {
      const data = await tool.handler(ctx, args ?? {});
      return { ok: true, tool: name, data, durationMs: Date.now() - started };
    } catch (e) {
      return {
        ok: false,
        tool: name,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - started,
      };
    }
  }
}
