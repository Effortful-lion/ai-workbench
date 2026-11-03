import { create } from "zustand";
import type { Socket } from "socket.io-client";
import type {
  ChatAssistantPayload,
  ChatDonePayload,
  ChatErrorPayload,
  ChatStartedPayload,
  ChatToolPayload,
  ConversationDto,
  MessageDto,
  TraceEvent,
} from "@aiwb/shared";
import { createChatSocket } from "../lib/socket";
import { api } from "../lib/api";
import { useAuthStore } from "./auth";

const ECHO_ID = "local-echo";

interface ChatState {
  connected: boolean;
  conversations: ConversationDto[];
  currentId: string | null;
  /** 新会话首条消息已发出、started 未回（用于界面立即切到工作态） */
  pendingNew: boolean;
  messages: MessageDto[];
  streaming: boolean;
  streamBuf: string;
  /** 本轮发送的错误（不落库，仅界面提示） */
  error: string | null;
  modelHint: string | null;
  /** 下一条新会话要绑定的 Agent（null = 通用助手） */
  pendingAgentId: string | null;
  /** 当前选中的模型 id（null = 让服务端自动挑默认 mock） */
  pendingModelId: string | null;
  /** 当前执行的 trace 事件流（终端迹线面板消费） */
  traceEvents: TraceEvent[];

  connect: () => void;
  disconnect: () => void;
  loadConversations: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
  newChat: () => void;
  /** 选择 Agent 并开新会话（null = 回到通用助手） */
  startAgentChat: (agentId: string | null) => void;
  /** 选择模型（不自动开新会话，仅影响下一条 send） */
  setModel: (modelId: string | null) => void;
  send: (content: string) => void;
  clearTrace: () => void;
}

let socket: Socket | null = null;

export const useChatStore = create<ChatState>()((set, get) => ({
  connected: false,
  conversations: [],
  currentId: null,
  pendingNew: false,
  messages: [],
  streaming: false,
  streamBuf: "",
  error: null,
  modelHint: null,
  pendingAgentId: null,
  pendingModelId: null,
  traceEvents: [],

  connect: () => {
    const token = useAuthStore.getState().accessToken;
    if (!token || socket) return;
    socket = createChatSocket(token);

    socket.on("connect", () => {
      set({ connected: true });
      void get().loadConversations();
    });
    socket.on("disconnect", () => set({ connected: false }));

    socket.on("started", (p: ChatStartedPayload) => {
      set((s) => ({
        currentId: p.conversationId,
        pendingNew: false,
        // 本地回显替换为服务端权威消息
        messages: [...s.messages.filter((m) => m.id !== ECHO_ID), p.userMessage],
        streaming: true,
        streamBuf: "",
        error: null,
        modelHint: `${p.model.provider}/${p.model.modelName}`,
        traceEvents: [],
      }));
    });
    socket.on("delta", (p: { conversationId: string; delta: string }) => {
      if (p.conversationId !== get().currentId) return;
      set((s) => ({ streamBuf: s.streamBuf + p.delta }));
    });
    socket.on("assistant", (p: ChatAssistantPayload) => {
      if (p.conversationId !== get().currentId) return;
      // 带原生 tool_calls 的 assistant 消息 → 触发 ToolCallBlock 渲染
      set((s) => ({ messages: [...s.messages, p.message] }));
    });
    socket.on("tool", (p: ChatToolPayload) => {
      if (p.conversationId !== get().currentId) return;
      // 工具结果消息插入流中（UI 渲染为工具调用块）
      set((s) => ({ messages: [...s.messages, p.message] }));
    });
    socket.on("trace", (ev: TraceEvent) => {
      set((s) => ({ traceEvents: [...s.traceEvents, ev] }));
    });
    socket.on("done", (p: ChatDonePayload) => {
      set((s) => ({ messages: [...s.messages, p.message], streaming: false, streamBuf: "" }));
      void get().loadConversations();
    });
    socket.on("error", (p: ChatErrorPayload) => {
      set({ error: p.error, streaming: false, streamBuf: "", pendingNew: false });
      void get().loadConversations();
    });
  },

  disconnect: () => {
    socket?.disconnect();
    socket = null;
    set({
      connected: false,
      conversations: [],
      currentId: null,
      pendingNew: false,
      messages: [],
      streaming: false,
      streamBuf: "",
      error: null,
      pendingAgentId: null,
      traceEvents: [],
    });
  },

  loadConversations: async () => {
    try {
      set({ conversations: await api<ConversationDto[]>("/chat/conversations") });
    } catch {
      /* 静默：列表失败不打扰主流程 */
    }
  },

  openConversation: async (id) => {
    const messages = await api<MessageDto[]>(`/chat/conversations/${id}/messages`);
    set({ currentId: id, pendingNew: false, messages, streaming: false, streamBuf: "", error: null });
  },

  removeConversation: async (id) => {
    await api(`/chat/conversations/${id}`, { method: "DELETE" });
    const { currentId } = get();
    if (currentId === id) get().newChat();
    await get().loadConversations();
  },

  newChat: () =>
    set({ currentId: null, pendingNew: false, messages: [], streaming: false, streamBuf: "", error: null, traceEvents: [] }),

  startAgentChat: (agentId) => {
    set({ pendingAgentId: agentId });
    get().newChat();
  },

  setModel: (modelId) => {
    set({ pendingModelId: modelId });
  },

  send: (content) => {
    const text = content.trim();
    if (!text || !socket || get().streaming) return;
    const { currentId, pendingAgentId, pendingModelId } = get();
    set((s) => ({
      error: null,
      pendingNew: !currentId,
      messages: [
        ...s.messages,
        { id: ECHO_ID, conversationId: currentId ?? "", role: "user", content: text, createdAt: Date.now() },
      ],
    }));
    // 仅新会话携带 agentId（服务端在创建时绑定）；modelId 每轮都可传
    socket.emit("send", {
      conversationId: currentId ?? undefined,
      content: text,
      ...(pendingModelId ? { modelId: pendingModelId } : {}),
      ...(currentId ? {} : pendingAgentId ? { agentId: pendingAgentId } : {}),
    });
  },

  clearTrace: () => set({ traceEvents: [] }),
}));
