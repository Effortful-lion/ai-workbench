import type { ToolSchemaDto } from "@aiwb/shared";
import type { ChatMessage, ToolDefinition } from "../llm/llm.adapter";

/** OpenAI 兼容接口要求 function.name 匹配 ^[a-zA-Z0-9_-]+$；
 *  操作目录原名带点号（mail.accounts.list），发模型前替换为下划线，回包再映射回原名。 */
const TOOL_NAME_INVALID = /[^a-zA-Z0-9_-]/g;

export function buildToolApiNames(schemas: ToolSchemaDto[]): {
  apiToReal: Map<string, string>;
  realToApi: Map<string, string>;
} {
  const apiToReal = new Map<string, string>();
  const realToApi = new Map<string, string>();
  for (const s of schemas) {
    let api = s.name.replace(TOOL_NAME_INVALID, "_");
    while (apiToReal.has(api)) api += "_"; // 极少数碰撞（a.b 与 a_b）时加后缀
    apiToReal.set(api, s.name);
    realToApi.set(s.name, api);
  }
  return { apiToReal, realToApi };
}

/** 修复非法 tool 序列：OpenAI 协议要求每条 tool 消息都紧跟对应的 assistant tool_calls。
 *  历史数据/中断请求/时间戳并列都可能造成孤儿 tool 消息或缺失回应，这里统一重建：
 *  以 assistant.tool_calls 的 id 为准配对，找不到回应就补占位，配不上的 tool 消息丢弃。 */
export function sanitizeToolSequence(messages: ChatMessage[]): ChatMessage[] {
  type WithCalls = ChatMessage & { tool_calls?: { id: string }[]; tool_call_id?: string };
  const byCallId = new Map<string, WithCalls>();
  for (const m of messages as WithCalls[]) {
    if (m.role === "tool" && m.tool_call_id && !byCallId.has(m.tool_call_id)) {
      byCallId.set(m.tool_call_id, m);
    }
  }

  const out: ChatMessage[] = [];
  for (const m of messages as WithCalls[]) {
    if (m.role === "tool") continue; // tool 消息只在配对时插入
    out.push(m);
    if (m.role === "assistant" && m.tool_calls?.length) {
      for (const call of m.tool_calls) {
        const hit = byCallId.get(call.id);
        byCallId.delete(call.id);
        out.push(
          hit ?? ({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: "工具未执行（历史记录缺失）" }),
          } as ChatMessage),
        );
      }
    }
  }
  return out;
}

/** ToolSchemaDto → OpenAI function definition（原生 function calling 请求体用） */
export function toToolDefinition(schema: ToolSchemaDto, apiName: string): ToolDefinition {
  return {
    type: "function",
    function: {
      name: apiName,
      description: schema.description,
      parameters: schema.argsSchema ?? { type: "object", properties: {} },
    },
  };
}

/** 安全解析模型生成的 arguments JSON；非法 JSON 给空对象，让执行层返回友好错误 */
export function safeParseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** 参数规范化：键排序后再序列化，避免 {a,b} 与 {b,a} 被当成两次不同调用 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}
