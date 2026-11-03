import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@aiwb/shared";

export const TOOL_META = "aiwb_tool_meta";

export interface ToolMeta {
  /** 命名空间名，如 'kb.search' */
  name: string;
  description: string;
  /** 所需权限点（权限即边界） */
  permission: Permission;
  /** 参数 JSON Schema，注入 LLM 指令 */
  argsSchema?: Record<string, unknown>;
}

/** 模块把能力注册为 AI 可调用工具：标在 provider 方法上，签名 (ctx, args) */
export const RegisterTool = (meta: ToolMeta) => SetMetadata(TOOL_META, meta);
