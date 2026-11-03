import { Injectable } from "@nestjs/common";

/** ── 原生 function calling 相关类型（OpenAI 兼容） ── */

export interface ToolCallDef {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolFunctionDef {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface ToolDefinition {
  type: "function";
  function: ToolFunctionDef;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** assistant 消息发起工具调用时携带 */
  tool_calls?: ToolCallDef[];
  /** tool 消息必须匹配 assistant 的 tool_calls[i].id */
  tool_call_id?: string;
}

export interface ChatResult {
  content: string;
  latencyMs: number;
  finishReason?: "stop" | "tool_calls" | "length" | null;
  toolCalls?: ToolCallDef[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/** 流式对话的 usage 收集器：SSE 最后一条事件带 usage（OpenAI 兼容） */
export interface StreamUsageRef {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    /** 豆包/DeepSeek 等 reasoning 模型的思维链 tokens（可能在 completion_tokens_details 里） */
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/** chatStream 产出的块：content 增量或完整结束结果 */
export type StreamChunk =
  | { type: "content"; delta: string }
  | {
      type: "done";
      finishReason: "stop" | "tool_calls" | "length" | null;
      toolCalls: ToolCallDef[];
      usage?: StreamUsageRef["usage"];
    };

/** LLM 适配层：以 OpenAI 兼容 /chat/completions 为基准协议，各厂商 endpoint 即接入。
 *  endpoint 以 mock:// 开头时返回内置应答（无 key 的本地开发/演示用）。
 *  一期同时支持指令式 ▸TOOL 与原生 function calling：有 tools 参数走原生，否则走指令式。 */
@Injectable()
export class LlmAdapter {
  async chat(opts: {
    endpoint: string;
    apiKey?: string | null;
    model: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    /** 采样温度；undefined/null 表示用厂商默认 */
    temperature?: number | null;
    /** top_k 采样；同上 */
    topK?: number | null;
    timeoutMs?: number;
  }): Promise<ChatResult> {
    const { endpoint, apiKey, model, messages, tools, timeoutMs = 30_000 } = opts;
    if (endpoint.startsWith("mock://")) {
      return this.mockReply(messages, tools);
    }
    const url = `${endpoint.replace(/\/+$/, "")}/chat/completions`;
    const started = Date.now();
    const body: Record<string, unknown> = { model, messages, stream: false };
    if (tools?.length) body.tools = tools;
    this.applySampling(body, opts.temperature, opts.topK);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: {
        message?: { content?: string; tool_calls?: ToolCallDef[] };
        finish_reason?: string;
      }[];
      usage?: ChatResult["usage"];
    };
    const msg = data.choices?.[0]?.message;
    return {
      content: msg?.content ?? "",
      latencyMs,
      finishReason: (data.choices?.[0]?.finish_reason as ChatResult["finishReason"]) ?? null,
      toolCalls: msg?.tool_calls,
      usage: data.usage,
    };
  }

  /** OpenAI 兼容 /embeddings。mock:// 不支持（调用方应降级本地向量） */
  async embed(opts: {
    endpoint: string;
    apiKey?: string | null;
    model: string;
    texts: string[];
    timeoutMs?: number;
  }): Promise<number[][]> {
    const { endpoint, apiKey, model, texts, timeoutMs = 30_000 } = opts;
    if (endpoint.startsWith("mock://")) throw new Error("mock endpoint has no embeddings");
    const url = `${endpoint.replace(/\/+$/, "")}/embeddings`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input: texts }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Embeddings ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: { embedding?: number[] }[] };
    return (data.data ?? []).map((d) => d.embedding ?? []);
  }

  /** 注入采样参数：仅在其为有限数值时写入，null/undefined 交给厂商默认 */
  private applySampling(
    body: Record<string, unknown>,
    temperature?: number | null,
    topK?: number | null,
  ): void {
    if (typeof temperature === "number" && Number.isFinite(temperature)) {
      body.temperature = temperature;
    }
    if (typeof topK === "number" && Number.isFinite(topK)) {
      body.top_k = topK;
    }
  }

  /** mock:// 非流式应答：原生 function calling 优先；否则指令式 ▸TOOL；否则普通文本 */
  private mockReply(messages: ChatMessage[], tools?: ToolDefinition[]): ChatResult {
    const last = messages[messages.length - 1];
    const lastContent = last?.content ?? "";

    // 原生 function calling 模式
    if (tools?.length && last?.role !== "tool") {
      // 上一条如果是 assistant 带了 tool_calls，说明这一轮已经是 mock 调完工具等结果了
      // 现在只判断：用户消息里有没有提到某个工具名
      const toolNames = tools.map((t) => t.function.name);
      const hit = toolNames.find((n) => lastContent.toLowerCase().includes(n.toLowerCase().split(".")[0].toLowerCase()));
      // 更宽松的匹配：按模块名
      const hit2 = !hit && toolNames.find((n) => {
        const short = n.split(".")[0].toLowerCase();
        return lastContent.toLowerCase().includes(short);
      });
      const picked = hit ?? hit2;
      if (picked) {
        return {
          content: "",
          latencyMs: 5,
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: `mock_${Date.now()}`,
              type: "function",
              function: { name: picked, arguments: "{}" },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        };
      }
      // 没命中 → 正常对话（提一下有哪些工具可用）
      return {
        content: `⚠ mock 模型（原生 function calling 模式）\n可用工具：${toolNames.join(", ")}\n在消息里提及工具名（如 "${toolNames[0]?.split(".")[0] ?? "mail"}"）即可触发演示。`,
        latencyMs: 5,
        finishReason: "stop",
        usage: { prompt_tokens: 1, completion_tokens: 30 },
      };
    }

    // 上一条是 tool 消息 → mock 工具结果后自然语言解读
    if (last?.role === "tool") {
      return {
        content: `⚠ 以下为工具真实执行结果（mock 模型转述）：\n\n${lastContent.slice(0, 600)}\n\n接入真实模型后，我会用更自然的语言为你解读结果。`,
        latencyMs: 5,
        finishReason: "stop",
        usage: { prompt_tokens: 1, completion_tokens: 40 },
      };
    }

    // 指令式 / 普通对话：看 system prompt 里有没有 ▸TOOL
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    if (system.includes("▸TOOL")) {
      const toolNames = [...system.matchAll(/^- ([\w.]+) —/gm)].map((m) => m[1]);
      const hit = toolNames.find((n) => lastContent.toLowerCase().includes(n.toLowerCase().split(".")[0].toLowerCase()));
      if (hit) return { content: `▸TOOL {"name":"${hit}","args":{}}`, latencyMs: 5, finishReason: "stop", usage: { prompt_tokens: 1, completion_tokens: 1 } };
      return {
        content: `⚠ mock 模型 + 指令式协议\n可用工具：${toolNames.join(", ")}\n提及工具名触发演示。`,
        latencyMs: 5,
        finishReason: "stop",
        usage: { prompt_tokens: 1, completion_tokens: 30 },
      };
    }

    // 普通 mock 回复
    return {
      content:
        `⚠ 我是 mock 模型（本地模拟回复，未调用真实 AI）\n\n` +
        `你刚才说：「${lastContent.slice(0, 80)}」\n\n` +
        `想体验真实 AI？点击对话栏顶部的模型下拉，切换到真实模型（如 volces-ark/doubao）即可。`,
      latencyMs: 5,
      finishReason: "stop",
      usage: { prompt_tokens: 1, completion_tokens: 50 },
    };
  }

  /** 流式对话：解析 OpenAI 兼容 SSE，逐段产出 content 增量 + 完整的 tool_calls 结束块。
   *  usageRef 若传入，SSE 末尾的 usage 会写入该对象（mock 模式也会填） */
  async *chatStream(opts: {
    endpoint: string;
    apiKey?: string | null;
    model: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    /** 采样温度；undefined/null 表示用厂商默认 */
    temperature?: number | null;
    /** top_k 采样；同上 */
    topK?: number | null;
    timeoutMs?: number;
    usageRef?: StreamUsageRef;
  }): AsyncGenerator<StreamChunk, void, unknown> {
    const { endpoint, apiKey, model, messages, tools, timeoutMs = 60_000, usageRef } = opts;

    if (endpoint.startsWith("mock://")) {
      const result = this.mockReply(messages, tools);
      if (result.toolCalls?.length) {
        // 原生 tool call：直接 yield done，不走 content
        yield {
          type: "done",
          finishReason: result.finishReason ?? "tool_calls",
          toolCalls: result.toolCalls,
          usage: result.usage,
        };
      } else {
        // 文本回复：逐字符 yield content，最后 yield done
        for (const ch of result.content ?? "") {
          yield { type: "content", delta: ch };
          await new Promise((r) => setTimeout(r, 6));
        }
        yield {
          type: "done",
          finishReason: result.finishReason ?? "stop",
          toolCalls: [],
          usage: result.usage,
        };
      }
      if (usageRef && result.usage) usageRef.usage = result.usage;
      return;
    }

    const url = `${endpoint.replace(/\/+$/, "")}/chat/completions`;
    const body: Record<string, unknown> = { model, messages, stream: true };
    if (tools?.length) body.tools = tools;
    this.applySampling(body, opts.temperature, opts.topK);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.body) throw new Error("LLM response has no body");

    // 按 index 累计 tool_calls 增量
    const callsByIndex = new Map<number, { id?: string; name?: string; args: string }>();
    let finishReason: "stop" | "tool_calls" | "length" | null = null;
    let finalUsage: StreamUsageRef["usage"] | undefined;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";

      for (const ev of events) {
        for (const line of ev.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (payload === "[DONE]") {
            // 组装完整 tool_calls
            const toolCalls: ToolCallDef[] = [...callsByIndex.entries()]
              .sort(([a], [b]) => a - b)
              .map(([, c]) => ({
                id: c.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
                type: "function",
                function: { name: c.name ?? "", arguments: c.args || "{}" },
              }));
            yield {
              type: "done",
              finishReason,
              toolCalls,
              usage: finalUsage,
            };
            if (usageRef && finalUsage) usageRef.usage = finalUsage;
            return;
          }
          try {
            const json = JSON.parse(payload) as {
              choices?: {
                delta?: {
                  content?: string;
                  tool_calls?: {
                    index: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }[];
                };
                finish_reason?: string | null;
              }[];
              usage?: StreamUsageRef["usage"];
            };

            const choice = json.choices?.[0];
            if (choice && choice.finish_reason !== undefined) {
              finishReason = choice.finish_reason as unknown as typeof finishReason;
            }

            const delta = choice?.delta;
            if (delta?.content) {
              yield { type: "content", delta: delta.content };
            }
            if (delta?.tool_calls?.length) {
              for (const tc of delta.tool_calls) {
                const slot = callsByIndex.get(tc.index) ?? { args: "" };
                if (tc.id) slot.id = tc.id;
                if (tc.function?.name) slot.name = tc.function.name;
                if (tc.function?.arguments) slot.args += tc.function.arguments;
                callsByIndex.set(tc.index, slot);
              }
            }
            if (json.usage) {
              finalUsage = json.usage;
              if (usageRef) usageRef.usage = json.usage;
            }
          } catch {
            /* 忽略半包/心跳行 */
          }
        }
      }
    }
  }
}
