/** AI 助手（Agent）：人设 prompt + 工具子集，权限上限不超过创建者 */

export interface AgentDto {
  id: string;
  ownerId: string;
  name: string;
  personaPrompt: string;
  /** 勾选的工具名子集（Tool Registry 中的 name） */
  tools: string[];
  /** 阶段化流程（可选）：按阶段切换模型/目标；null = 单模型直跑 */
  phases?: AgentPhase[] | null;
  /** 运行预算（可选）：超预算自动停止 */
  budget?: AgentBudget | null;
  createdAt: number;
}

export interface UpsertAgentInput {
  name: string;
  personaPrompt?: string;
  tools?: string[];
  phases?: AgentPhase[] | null;
  budget?: AgentBudget | null;
}

/* ── Budget：Agent 运行时的资源安全带 ── */

export interface AgentBudget {
  /** 同时发起的子任务上限 */
  maxConcurrency: number;
  /** 递归深度（子会话派生子会话算一层） */
  maxDepth: number;
  /** 整次执行最多消耗 token（输入+输出） */
  maxTotalTokens: number;
  /** 最多花多少钱（元） */
  maxCostYuan: number;
  /** 单次执行最长秒数 */
  timeoutSec: number;
}

/** 默认预算，保守但实用 */
export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  maxConcurrency: 4,
  maxDepth: 2,
  maxTotalTokens: 100_000,
  maxCostYuan: 5,
  timeoutSec: 300,
};

/* ── Phase：同会话内的模型接力工位 ── */

export interface AgentPhase {
  /** 阶段名，如「调研」「实现」「评审」 */
  name: string;
  /** 使用的模型 id（Models 表的 id）；null = 让服务端自动挑 */
  modelId?: string | null;
  /** 该阶段要达成的目标（注入 system prompt） */
  goal: string;
  /** 该阶段允许使用的工具子集（覆盖 Agent 默认 tools）；null = 跟 Agent 一样 */
  tools?: string[] | null;
  /** 是否需要人工确认再进入下一阶段 */
  requireConfirm?: boolean;
}

/* ── Execution Trace：Agent 一次运行的事件迹线 ── */

export type TraceEventType =
  | "phase.started"
  | "phase.done"
  | "tool.started"
  | "tool.done"
  | "tool.failed"
  | "agent.started"
  | "agent.done"
  | "agent.failed"
  | "agent.aborted"
  | "budget.hit"
  | "sub.started"
  | "sub.done";

export interface TraceEvent {
  /** 事件类型 */
  type: TraceEventType;
  /** 时间戳（毫秒） */
  ts: number;
  /** 人类可读的一行摘要 */
  summary: string;
  /** 可选的结构化载荷（tool name / duration / error / tokens …） */
  payload?: Record<string, unknown>;
  /** 嵌套层级：根 Agent = 0，子 Agent = 1，孙 = 2 */
  depth?: number;
}

/** 一次 Agent 执行的完整迹线 */
export interface AgentExecutionTrace {
  id: string;
  agentId: string | null;
  conversationId: string;
  /** 启动用户 id */
  userId: string;
  /** 使用的模型 id */
  modelId: string;
  modelName: string;
  /** 绑定的阶段名（有 phase flow 时） */
  phaseName?: string | null;
  /** 根 Agent 的事件流；子 Agent 通过 sub.started/sub.done 包裹 */
  events: TraceEvent[];
  status: "running" | "done" | "failed" | "budget";
  durationMs: number;
  tokensUsed: number;
  costYuan: number;
  startedAt: number;
  finishedAt?: number | null;
}
