import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  AgentBudget,
  AgentExecutionTrace,
  TraceEvent,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { agentExecutions } from "../db/schema";

/**
 * Agent 执行迹线（Trace）服务
 *
 * 设计原则（抄自 Lancer）：
 *   - 一次执行一条记录，events 以 JSON 整体落库（避免事件表行数爆炸）
 *   - 每个事件带真实 ts + 人类可读 summary + 可选 payload
 *   - 预算检查走同步方法（checkBudget），gateway 在每个 tool_call 之前调
 */
@Injectable()
export class TraceService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** 启动一次执行：插一条 running 记录，返回 executionId */
  async start(input: {
    userId: string;
    agentId: string | null;
    conversationId: string;
    modelId: string;
    modelName: string;
    phaseName?: string | null;
  }): Promise<string> {
    const row: typeof agentExecutions.$inferInsert = {
      id: randomUUID(),
      ownerId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      modelId: input.modelId,
      modelName: input.modelName,
      phaseName: input.phaseName ?? "",
      eventsJson: [],
      status: "running",
      durationMs: 0,
      tokensUsed: 0,
      costYuan: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.db.insert(agentExecutions).values(row);
    return row.id;
  }

  /** 追加一个事件（内存累积 + 每次全量覆盖写 eventsJson） */
  async append(executionId: string, event: TraceEvent): Promise<void> {
    const [row] = await this.db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.id, executionId));
    if (!row) return;
    const events = [...((row.eventsJson ?? []) as TraceEvent[]), event];
    await this.db
      .update(agentExecutions)
      .set({ eventsJson: events, updatedAt: new Date() })
      .where(eq(agentExecutions.id, executionId));
  }

  /** 完成一次执行：写终态 + 更新 duration/tokens/cost */
  async finish(
    executionId: string,
    input: {
      status: "done" | "failed" | "budget";
      error?: string;
      tokensUsed?: number;
      costYuan?: number;
    },
  ): Promise<void> {
    const [row] = await this.db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.id, executionId));
    if (!row) return;
    const durationMs = Date.now() - row.createdAt.getTime();
    await this.db
      .update(agentExecutions)
      .set({
        status: input.status,
        durationMs,
        tokensUsed: input.tokensUsed ?? row.tokensUsed,
        costYuan: input.costYuan ?? row.costYuan,
        error: input.error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(agentExecutions.id, executionId));
  }

  /** 按会话查最近执行（用于前端恢复上下文） */
  async latestByConversation(conversationId: string): Promise<AgentExecutionTrace | null> {
    const [row] = await this.db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.conversationId, conversationId))
      .orderBy(desc(agentExecutions.createdAt))
      .limit(1);
    if (!row) return null;
    return this.toTrace(row);
  }

  /** 按 agent 查历史（用户面板展示） */
  async listByAgent(agentId: string, limit = 20): Promise<AgentExecutionTrace[]> {
    const rows = await this.db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.agentId, agentId))
      .orderBy(desc(agentExecutions.createdAt))
      .limit(limit);
    return rows.map((r) => this.toTrace(r));
  }

  /** 按用户查最近所有执行（首页/CLI 面板） */
  async listByUser(userId: string, limit = 30): Promise<AgentExecutionTrace[]> {
    const rows = await this.db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.ownerId, userId))
      .orderBy(desc(agentExecutions.createdAt))
      .limit(limit);
    return rows.map((r) => this.toTrace(r));
  }

  private toTrace(row: typeof agentExecutions.$inferSelect): AgentExecutionTrace {
    return {
      id: row.id,
      agentId: row.agentId ?? null,
      conversationId: row.conversationId ?? "",
      userId: row.ownerId,
      modelId: row.modelId ?? "",
      modelName: row.modelName,
      phaseName: row.phaseName || null,
      events: ((row.eventsJson ?? []) as TraceEvent[]).sort((a, b) => a.ts - b.ts),
      status: row.status,
      durationMs: row.durationMs,
      tokensUsed: row.tokensUsed,
      costYuan: row.costYuan,
      startedAt: row.createdAt.getTime(),
      finishedAt: row.updatedAt.getTime(),
    };
  }
}

/* ── 预算运行时（同步类，不依赖 DB） ── */

export interface BudgetSnapshot {
  tokens: number;
  costYuan: number;
  startedAt: number;
}

export interface BudgetCheckResult {
  ok: boolean;
  reason?: "tokens" | "cost" | "timeout" | "depth" | "concurrency";
}

/** 纯函数：每次 tool_call 之前调一次 */
export function checkBudget(
  budget: AgentBudget,
  snapshot: BudgetSnapshot,
  depth = 0,
  runningChildren = 0,
): BudgetCheckResult {
  if (snapshot.tokens >= budget.maxTotalTokens) return { ok: false, reason: "tokens" };
  if (snapshot.costYuan >= budget.maxCostYuan) return { ok: false, reason: "cost" };
  if (Date.now() - snapshot.startedAt >= budget.timeoutSec * 1000)
    return { ok: false, reason: "timeout" };
  if (depth > budget.maxDepth) return { ok: false, reason: "depth" };
  if (runningChildren >= budget.maxConcurrency) return { ok: false, reason: "concurrency" };
  return { ok: true };
}
