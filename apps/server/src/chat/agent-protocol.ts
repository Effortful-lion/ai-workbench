/**
 * 旧指令式协议（▸TOOL）已废弃，保留文件是为了向后兼容引用。
 * 现在统一用 OpenAI 原生 function calling：tools 放请求体，tool_calls 从流式响应里取。
 */

export const TOOL_DIRECTIVE = "▸TOOL";

/** 仅留人设，不再塞工具清单（原生协议 tools 在请求 body 里） */
export function buildAgentSystemPrompt(persona: string, _tools: unknown[]): string {
  return persona.trim() || "你是 AI 工作台里的一个 Agent。";
}

/** @deprecated 原生 function calling 下不再需要 */
export function parseToolCalls(_text: string): never[] {
  return [];
}

/** @deprecated 原生 function calling 下不再需要 */
export function stripDirectives(text: string): string {
  return text.trim();
}
