import { describe, expect, it, vi } from "vitest";
import type { MessageDto, Role } from "@aiwb/shared";
import { ChatOrchestrator, type ChatSession } from "./chat-orchestrator.service";

/** 构造一个满足 ChatService.appendMessage 返回形状的 MessageDto */
function msg(conversationId: string, role: string, content: string): MessageDto {
  return {
    id: `m_${Math.random().toString(36).slice(2)}`,
    conversationId,
    role: role as MessageDto["role"],
    content,
    createdAt: Date.now(),
  };
}

/** 直跑模式、纯文本回复的 happy-path 依赖桩 */
function buildMocks(modelAvailable = true) {
  const model = {
    id: "model-1",
    modelName: "test-model",
    provider: "openai",
    endpoint: "https://api.test/v1",
    apiKey: "sk-test",
    temperature: 0.7,
    topK: 40,
  };
  const chat = {
    getOwnedConversation: vi.fn(),
    createConversation: vi.fn(async (userId: string, content: string) => ({
      id: "c1",
      title: content.slice(0, 24),
      agentId: null,
      createdAt: Date.now(),
    })),
    appendMessage: vi.fn(async (conversationId: string, role: string, content: string) =>
      msg(conversationId, role, content),
    ),
    pickModel: vi.fn(async () => (modelAvailable ? model : null)),
    buildContext: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
  };
  const llm = {
    chatStream: vi.fn(async function* () {
      yield { type: "content", delta: "hi" } as never;
      yield {
        type: "done",
        finishReason: "stop",
        toolCalls: [],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      } as never;
    }),
  };
  const agents = { getOwned: vi.fn() };
  const registry = {
    listForRole: vi.fn(() => []),
    execute: vi.fn(),
  };
  const trace = {
    start: vi.fn(async () => "e1"),
    append: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
  };
  const capability = {
    route: vi.fn(async () => ({ kind: "general", modules: [] })),
    retrieve: vi.fn(async () => ""),
  };
  return { chat, llm, agents, registry, trace, capability, model };
}

function makeSession(over: Partial<ChatSession> = {}): ChatSession {
  return {
    user: { id: "u1", selfId: "u1", username: "u", role: "owner" as Role },
    dataId: "u1",
    content: "hi",
    clientId: "sock1",
    abortController: new AbortController(),
    emit: vi.fn(),
    ...over,
  };
}

describe("ChatOrchestrator", () => {
  it("直跑模式：纯文本回复走完整生命周期并发出 started/delta/done", async () => {
    const m = buildMocks();
    const orch = new ChatOrchestrator(
      m.chat as never,
      m.llm as never,
      m.agents as never,
      m.registry as never,
      m.trace as never,
      m.capability as never,
    );
    const session = makeSession();
    await orch.run(session);

    const emit = session.emit as unknown as ReturnType<typeof vi.fn>;
    const events = emit.mock.calls.map((c) => c[0]);

    expect(events).toContain("started");
    expect(events).toContain("delta");
    expect(events).toContain("done");
    // delta 携带正文片段
    expect(emit.mock.calls.some((c) => c[0] === "delta" && (c[1] as { delta: string }).delta === "hi")).toBe(true);
    // done 事件带回最终 assistant 消息
    const done = emit.mock.calls.find((c) => c[0] === "done");
    expect((done![1] as { message: MessageDto }).message.content).toBe("hi");
    // 无错误
    expect(events).not.toContain("error");
    // trace 被启动与收尾
    expect(m.trace.start).toHaveBeenCalledOnce();
    expect(m.trace.finish).toHaveBeenCalledOnce();
  });

  it("无可用模型时仅发出 error，不创建会话/迹线", async () => {
    const m = buildMocks(false);
    const orch = new ChatOrchestrator(
      m.chat as never,
      m.llm as never,
      m.agents as never,
      m.registry as never,
      m.trace as never,
      m.capability as never,
    );
    const session = makeSession();
    await orch.run(session);

    const emit = session.emit as unknown as ReturnType<typeof vi.fn>;
    const events = emit.mock.calls.map((c) => c[0]);
    expect(events).toContain("error");
    expect(events).not.toContain("done");
    // 模型选择失败发生在 trace.start 之前，故不应启动迹线
    expect(m.trace.start).not.toHaveBeenCalled();
  });
});
