import type { Role, Permission } from "./roles.js";

/** 工具调用上下文：由网关按当前会话用户注入 */
export interface ToolContext {
  userId: string;
  role: Role;
  /** 用户名（目录工具内部签发临时 token 时透传，便于 /resume 等按用户名取数） */
  username?: string;
}

/** 工具类型体系：function=本地函数（内置）；http=声明式 HTTP（已实现）；
 *  shell/database/mcp 为预留类型，数据模型与 UI 先行，执行器后续迭代落地 */
export const TOOL_KINDS = ["function", "http", "shell", "database", "mcp"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

/** 工具定义：模块能力的统一描述，HTTP API 与 AI Tool 共用 service 层 */
export interface ToolDef<A = Record<string, unknown>, R = unknown> {
  /** 命名空间名，如 'kb.search' */
  name: string;
  description: string;
  /** 所需权限点 */
  permission: Permission;
  /** 参数 JSON Schema（注入 LLM function calling） */
  argsSchema?: Record<string, unknown>;
  /** 工具类型；内置 @RegisterTool 工具缺省为 function */
  kind?: ToolKind;
  /** 是否用户自定义工具（custom.* 命名空间，面板展示/启停用） */
  custom?: boolean;
  handler: (ctx: ToolContext, args: A) => Promise<R>;
}

/** 可序列化的工具描述（GET /tools 出网用，handler 不离开进程） */
export interface ToolSchemaDto {
  name: string;
  description: string;
  permission: Permission;
  argsSchema?: Record<string, unknown>;
  kind?: ToolKind;
  custom?: boolean;
}

/** 自定义 HTTP 工具的执行声明（MVP：模板渲染 + fetch，无代码沙箱） */
export interface HttpToolSpec {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** 支持 {{key}} 模板占位，url 中的值会 encodeURIComponent */
  url: string;
  headers?: Record<string, string>;
  /** POST/PUT 请求体模板，{{key}} 原样替换 */
  bodyTemplate?: string;
}

/** 自定义工具记录（custom_tools 表出网 DTO） */
export interface CustomToolDto {
  id: string;
  ownerId: string;
  /** 强制 custom. 前缀，全局唯一 */
  name: string;
  description: string;
  kind: ToolKind;
  spec: HttpToolSpec;
  argsSchema?: Record<string, unknown> | null;
  /** 默认停用：人工在面板启用后才注册进 ToolRegistry */
  enabled: boolean;
  /** ai = 聊天里 AI 自写；user = 面板手工创建 */
  createdBy: "ai" | "user";
  createdAt: string;
}

/** 创建/更新自定义工具的输入（REST 与 tools.create meta 工具共用） */
export interface UpsertCustomToolInput {
  name: string;
  description: string;
  method?: HttpToolSpec["method"];
  url: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  argsSchema?: Record<string, unknown>;
}

/** 工具调用结果信封（WS / API 统一） */
export interface ToolResult<T = unknown> {
  ok: boolean;
  tool: string;
  data?: T;
  error?: string;
  durationMs?: number;
}
