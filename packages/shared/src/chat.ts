/** 对话中枢：会话/消息 DTO 与 WS 事件协议（namespace: /chat） */

export interface ConversationDto {
  id: string;
  title: string;
  agentId?: string | null;
  createdAt: number;
}

export type MessageRole = "user" | "assistant" | "tool";

export interface ToolCallRef {
  id: string;
  name: string;
  arguments: string;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  /** 原生 function calling 扩展字段 */
  toolCallId?: string;
  toolCalls?: ToolCallRef[];
}

/* ── WS 事件（client → server） ── */
export interface ChatSendPayload {
  /** 缺省 = 新会话 */
  conversationId?: string;
  content: string;
  /** 指定模型，缺省由服务端挑选（优先 status=ok） */
  modelId?: string;
  /** 仅新建会话时生效：绑定 Agent（人设 + 工具子集注入） */
  agentId?: string;
}

/* ── WS 事件（server → client） ── */
export interface ChatStartedPayload {
  conversationId: string;
  userMessage: MessageDto;
  assistantMessageId: string;
  model: { id: string; modelName: string; provider: string };
  /** 本会话绑定的 Agent（无则 null） */
  agentId?: string | null;
}

/** Agent 工具调用事件：服务端执行完一个工具后推送（结果已落库为 tool 消息） */
export interface ChatToolPayload {
  conversationId: string;
  name: string;
  ok: boolean;
  error?: string;
  durationMs: number;
  /** 落库的 tool 消息（内容 = 人类可读的工具结果摘要） */
  message: MessageDto;
}
export interface ChatAssistantPayload {
  conversationId: string;
  /** 带原生 tool_calls 的 assistant 消息（触发前端 ToolCallBlock 渲染） */
  message: MessageDto;
}

export interface ChatDeltaPayload {
  conversationId: string;
  messageId: string;
  delta: string;
}
export interface ChatDonePayload {
  conversationId: string;
  message: MessageDto;
}
export interface ChatErrorPayload {
  conversationId?: string;
  error: string;
}
