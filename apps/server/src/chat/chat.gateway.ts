import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import { DEFAULT_AGENT_BUDGET, hasPermission, type AgentPhase } from "@aiwb/shared";
import type {
  ChatDonePayload,
  ChatErrorPayload,
  ChatSendPayload,
  ChatStartedPayload,
  ChatToolPayload,
  Role,
  TraceEvent,
  ToolCallRef,
  ToolSchemaDto,
} from "@aiwb/shared";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { ChatService, type MessageMeta } from "./chat.service";
import { TraceService, checkBudget } from "./trace.service";
import {
  LlmAdapter,
  type ChatMessage,
  type StreamChunk,
  type StreamUsageRef,
  type ToolCallDef,
  type ToolDefinition,
} from "../llm/llm.adapter";
import { AgentsService } from "../agents/agents.service";
import { ToolRegistry } from "../tools/tool-registry.service";

/** 单轮对话中工具调用上限，防死循环 */
const MAX_TOOL_CALLS = 12;

/** ToolSchemaDto → OpenAI function definition（原生 function calling 请求体用） */
function toToolDefinition(schema: ToolSchemaDto): ToolDefinition {
  return {
    type: "function",
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.argsSchema ?? { type: "object", properties: {} },
    },
  };
}

/** 安全解析模型生成的 arguments JSON；非法 JSON 给空对象，让执行层返回友好错误 */
function safeParseArgs(raw: string | undefined): Record<string, unknown> {
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

/** 对话中枢 WS 通道：握手带 accessToken，事件流 send → started → (delta|tool|trace)×N → done */
@WebSocketGateway({ namespace: "/chat", cors: { origin: true, credentials: true } })
export class ChatGateway implements OnGatewayConnection {
  private readonly log = new Logger("chat");

  constructor(
    private readonly jwt: JwtService,
    private readonly chat: ChatService,
    private readonly llm: LlmAdapter,
    private readonly agents: AgentsService,
    private readonly registry: ToolRegistry,
    private readonly trace: TraceService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Socket.IO/WebSocket 握手里拿 token：auth 优先（socket.io-client 在 polling 下会同时放 query）
      const token: string | undefined =
        (client.handshake.auth?.token as string) ??
        client.handshake.query?.token as string | undefined ??
        client.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) throw new Error("missing token");
      const payload = await this.jwt.verifyAsync<{ sub: string; username: string; role: Role }>(token);
      const user: AuthUser = { id: payload.sub, username: payload.username, role: payload.role };
      if (!hasPermission(user.role, "chat:use")) throw new Error("requires chat:use");
      client.data.user = user;
    } catch {
      client.emit("error", { error: "unauthorized" } satisfies ChatErrorPayload);
      client.disconnect(true);
    }
  }

  @SubscribeMessage("send")
  async onSend(@ConnectedSocket() client: Socket, @MessageBody() body: ChatSendPayload) {
    const user = client.data.user as AuthUser | undefined;
    if (!user) return client.emit("error", { error: "unauthorized" } satisfies ChatErrorPayload);
    const content = (body?.content ?? "").trim();
    if (!content) return;

    // 预算 & 迹线运行时（每次 send 独立一份）
    const snapshot = { tokens: 0, costYuan: 0, startedAt: Date.now() };
    let budget = DEFAULT_AGENT_BUDGET; // 先用默认，后面 Agent 有自带预算会覆盖
    let executionId: string | null = null;
    // 关键：用串行队列避免 append 的 race condition（read-push-update 模式）
    let appendQueue: Promise<void> = Promise.resolve();
    const emitTrace = (event: Omit<TraceEvent, "ts"> & { ts?: number }) => {
      const ev: TraceEvent = { ts: Date.now(), ...event };
      client.emit("trace", ev);
      if (executionId) {
        appendQueue = appendQueue.then(
          () => this.trace.append(executionId!, ev),
          () => this.trace.append(executionId!, ev),
        ).catch((e) => this.log.warn(`trace append failed: ${e.message}`));
      }
    };

    try {
      // 1. 会话：缺省新建（新建时可绑定 Agent）
      const convo = body.conversationId
        ? await this.chat.getOwnedConversation(body.conversationId, user.id)
        : await this.chat.createConversation(user.id, content, body.agentId);

      // 2. 用户消息落库
      const userMessage = await this.chat.appendMessage(convo.id, "user", content);

      // 3. 挑默认模型
      const defaultModel = await this.chat.pickModel(body.modelId);
      if (!defaultModel) {
        client.emit("error", {
          conversationId: convo.id,
          error: "尚未接入任何模型 —— ⌘K 打开模型管理先接入一个",
        } satisfies ChatErrorPayload);
        return;
      }

      // 4. Agent：人设 + 工具子集 + 预算 + 阶段
      let personaPrompt = "你是 AI 工作台里的一个 Agent。";
      let boundAgentId: string | null = null;
      let agentTools = new Set<string>();
      let phases: AgentPhase[] = [];
      let usePhaseFlow = false;
      const allToolSchemas: ToolSchemaDto[] = this.registry.listForRole(user.role);

      if (convo.agentId) {
        const agent = await this.agents.getOwned(convo.agentId, user.id);
        if (agent) {
          agent.tools.forEach((t) => agentTools.add(t));
          personaPrompt = agent.personaPrompt || personaPrompt;
          boundAgentId = agent.id;
          if (agent.budget) budget = { ...DEFAULT_AGENT_BUDGET, ...agent.budget };
          if (agent.phases && agent.phases.length) {
            phases = agent.phases;
            usePhaseFlow = true;
          }
        }
      }

      // 直跑模式（未绑定 Agent）或 Agent 里存的工具名已下线时，默认放行当前角色可见的全部工具，
      // 否则模型会因为没有工具清单而答“我没有权限访问”。
      const known = new Set(allToolSchemas.map((t) => t.name));
      const validAgentTools = [...agentTools].filter((name) => known.has(name));
      if (validAgentTools.length === 0) {
        allToolSchemas.forEach((t) => agentTools.add(t.name));
      } else {
        agentTools = new Set(validAgentTools);
      }

      // 启动 trace execution
      executionId = await this.trace.start({
        userId: user.id,
        agentId: boundAgentId,
        conversationId: convo.id,
        modelId: defaultModel.id,
        modelName: defaultModel.modelName,
      });

      client.emit("started", {
        conversationId: convo.id,
        userMessage,
        assistantMessageId: randomUUID(), // 占位，前端主要依赖 done 事件里的最终消息
        model: { id: defaultModel.id, modelName: defaultModel.modelName, provider: defaultModel.provider },
        agentId: boundAgentId,
      } satisfies ChatStartedPayload);

      emitTrace({
        type: "agent.started",
        summary: boundAgentId
          ? `▸ agent "${boundAgentId.slice(0, 8)}…" 启动  tools=[${[...agentTools].join(",") || "(none)"}]${usePhaseFlow ? `  phases=${phases.map((p) => p.name).join("→")}` : ""}`
          : "▸ 直跑模式（无 Agent 绑定）",
      });

      // 5. 共享上下文（所有 phase 共用）
      // 从 DB 读回完整历史，原生协议还原 tool role / tool_calls；旧数据（无 meta 的 tool 消息）降级成 user
      const history = await this.chat.buildContext(convo.id);
      const baseMessages: ChatMessage[] = history.map((m) => {
        if (m.role === "tool") {
          if (m.toolCallId) {
            return { role: "tool", content: m.content, tool_call_id: m.toolCallId } as ChatMessage;
          }
          // 旧指令式 tool 消息 → 降级成 user 提示
          return {
            role: "user",
            content: `【工具结果】${m.content.slice(0, 2000)}`,
          } as ChatMessage;
        }
        if (m.role === "assistant") {
          if (m.toolCalls?.length) {
            return {
              role: "assistant",
              content: m.content,
              tool_calls: m.toolCalls.map((tc: ToolCallRef) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            } as ChatMessage;
          }
          return { role: "assistant", content: m.content } as ChatMessage;
        }
        return { role: "user", content: m.content } as ChatMessage;
      });

      let toolCallsLeft = MAX_TOOL_CALLS;
      let hitBudget = false;
      let lastAssistantContent = "";

      // ═══ Phase 迭代器 ═══
      const phaseList: AgentPhase[] = usePhaseFlow ? phases : [{ name: "main", goal: "", tools: null }];

      for (let phaseIdx = 0; phaseIdx < phaseList.length; phaseIdx++) {
        if (hitBudget) break;

        const phase = phaseList[phaseIdx];

        // 5a. 决定本 phase 的模型（phase.modelId ?→ defaultModel）
        const phaseModel = phase.modelId
          ? (await this.chat.pickModel(phase.modelId)) ?? defaultModel
          : defaultModel;

        // 5b. 决定本 phase 的工具子集（phase.tools ?? agent.tools，交集用户权限）
        const phaseToolNames = phase.tools && phase.tools.length
          ? phase.tools.filter((t) => agentTools.has(t) && allToolSchemas.some((s) => s.name === t))
          : [...agentTools];
        const phaseToolSet = new Set(phaseToolNames);
        const phaseSchemas = allToolSchemas.filter((t) => phaseToolSet.has(t.name));
        const phaseToolDefs: ToolDefinition[] = phaseSchemas.map(toToolDefinition);

        // 5c. 构建 phase 专属 system prompt：原生协议下只留人设，工具清单由 tools 参数承载
        const phasePersona = phase.goal
          ? `${personaPrompt}\n\n【当前阶段：${phase.name}】\n目标：${phase.goal}`
          : personaPrompt;

        // 5d. 本 phase 的 LLM messages：system(phase) + 已累积上下文
        const llmMessages: ChatMessage[] = [
          { role: "system", content: phasePersona },
          ...baseMessages,
        ];

        const phaseLabel = usePhaseFlow ? `[${phaseIdx + 1}/${phaseList.length}] ${phase.name}` : "main";

        emitTrace({
          type: "phase.started",
          summary: `▶ phase ${phaseLabel}  model=${phaseModel.provider}/${phaseModel.modelName}  tools=[${phaseToolNames.join(",") || "(none)"}]`,
          payload: { phaseIndex: phaseIdx, phaseName: phase.name },
        });

        // 5e. 本 phase 内部的生成 + 工具调用循环
        let phaseBreak = false;
        while (!phaseBreak) {
          // 预算准入
          const bc = checkBudget(budget, snapshot);
          if (!bc.ok) {
            hitBudget = true;
            emitTrace({
              type: "budget.hit",
              summary: `⚠ 预算打线：${bc.reason}（tokens=${snapshot.tokens}/${budget.maxTotalTokens}，elapsed=${((Date.now() - snapshot.startedAt) / 1000).toFixed(1)}s/${budget.timeoutSec}s）`,
              payload: { reason: bc.reason, tokens: snapshot.tokens, cost: snapshot.costYuan },
            });
            phaseBreak = true;
            break;
          }

          const usageRef: StreamUsageRef = {};
          let fullText = "";
          let doneChunk: StreamChunk | null = null;

          for await (const chunk of this.llm.chatStream({
            endpoint: phaseModel.endpoint,
            apiKey: phaseModel.apiKey,
            model: phaseModel.modelName,
            messages: llmMessages,
            tools: phaseToolDefs,
            temperature: phaseModel.temperature,
            topK: phaseModel.topK,
            usageRef,
          })) {
            if (chunk.type === "content") {
              fullText += chunk.delta;
              client.emit("delta", { conversationId: convo.id, delta: chunk.delta });
            } else {
              doneChunk = chunk;
            }
          }

          // 真实 token 计数（用 provider 上报的 usage，没有则 fallback 到估算）
          let promptTokens = 0;
          let completionTokens = 0;
          let reasoningTokens = 0;
          if (usageRef.usage) {
            promptTokens = usageRef.usage.prompt_tokens ?? 0;
            completionTokens = usageRef.usage.completion_tokens ?? 0;
            reasoningTokens = usageRef.usage.completion_tokens_details?.reasoning_tokens ?? 0;
            snapshot.tokens +=
              usageRef.usage.total_tokens ?? (promptTokens + completionTokens + reasoningTokens);
          } else {
            snapshot.tokens += Math.floor(fullText.length / 4);
          }

          // 真实 cost 换算（单位：分。priceIn/Out = 分/1k tokens）
          const pIn = (phaseModel as { priceIn?: number }).priceIn ?? 0;
          const pOut = (phaseModel as { priceOut?: number }).priceOut ?? 0;
          if (usageRef.usage && (pIn > 0 || pOut > 0)) {
            snapshot.costYuan += Math.round(
              (promptTokens * pIn) / 1000 + ((completionTokens + reasoningTokens) * pOut) / 1000,
            );
          }

          // 根据 finish_reason 分流
          const finish = doneChunk?.finishReason ?? null;
          const toolCalls = doneChunk?.toolCalls ?? [];
          const isToolCall = finish === "tool_calls" && toolCalls.length > 0;

          if (!isToolCall) {
            // 纯文本或 finish_reason = stop → phase 结束
            lastAssistantContent = fullText.trim();
            // 落库 assistant 消息（原生协议可能有内容 + 空 tool_calls，或纯内容）
            if (fullText.trim()) {
              await this.chat.appendMessage(convo.id, "assistant", fullText.trim());
            }
            emitTrace({
              type: "phase.done",
              summary: `✓ phase ${phaseLabel}  LLM 产出文本（finish_reason=${finish ?? "stop"}, tokens≈${snapshot.tokens}）`,
              payload: usageRef.usage ? { usage: usageRef.usage } : undefined,
            });
            phaseBreak = true;
            break;
          }

          // ── 原生 tool_calls 分支 ──
          // 落库 assistant 消息（content 可能为空，meta 带 tool_calls）
          const assistantMeta: MessageMeta = {
            toolCalls: toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            })),
          };
          const assistantWithTc = await this.chat.appendMessage(convo.id, "assistant", fullText.trim() || "(工具调用)", assistantMeta);

          // ⚠️ 关键：把带 toolCalls 的 assistant 消息 emit 给前端，让 groupMessages 能识别并渲染 ToolCallBlock
          client.emit("assistant", { conversationId: convo.id, message: assistantWithTc });

          // 回灌 LLM：assistant 消息（带 tool_calls）
          llmMessages.push({
            role: "assistant",
            content: fullText.trim(),
            tool_calls: toolCalls,
          } as ChatMessage);

          // 逐个 execute + emit trace + WS tool 事件 + 落库 tool 消息 + 回灌 tool 消息
          for (const tc of toolCalls) {
            if (toolCallsLeft-- <= 0) {
              this.log.warn(`tool call limit reached in conversation ${convo.id}`);
              emitTrace({ type: "budget.hit", summary: "⚠ 工具调用次数达上限（防死循环）" });
              hitBudget = true;
              phaseBreak = true;
              break;
            }

            const args = safeParseArgs(tc.function.arguments);
            const toolStart = Date.now();
            const result = phaseToolSet.has(tc.function.name)
              ? await this.registry.execute(
                  { userId: user.id, username: user.username, role: user.role },
                  tc.function.name,
                  args,
                )
              : {
                  ok: false as const,
                  tool: tc.function.name,
                  error: `工具 ${tc.function.name} 不在 phase[${phase.name}] 的工具集内`,
                  durationMs: 0,
                };
            const toolDuration = Date.now() - toolStart;

            emitTrace({
              type: "tool.started",
              summary: `▸ [tool] ${tc.function.name}`,
              payload: { args },
            });

            if (result.ok) {
              emitTrace({
                type: "tool.done",
                summary: `  ↳ ${tc.function.name} ✓ ${toolDuration}ms`,
                payload: { durationMs: toolDuration },
              });
            } else {
              emitTrace({
                type: "tool.failed",
                summary: `  ↳ ${tc.function.name} ✗ ${toolDuration}ms — ${result.error}`,
                payload: { durationMs: toolDuration, error: result.error },
              });
            }

            // DB 存纯 JSON，方便原生协议回灌；WS 事件 content 也用纯 JSON（前端可后续优化展示）
            const toolPayload = result.ok
              ? JSON.stringify(result.data)
              : JSON.stringify({ ok: false, error: result.error });
            const toolMessage = await this.chat.appendMessage(convo.id, "tool", toolPayload, {
              toolCallId: tc.id,
            });
            client.emit("tool", {
              conversationId: convo.id,
              name: tc.function.name,
              ok: result.ok,
              error: result.error,
              durationMs: toolDuration,
              message: toolMessage,
            } satisfies ChatToolPayload);

            // 回灌 LLM：tool 消息（带 tool_call_id，匹配 assistant 的 tool_calls[i].id）
            llmMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolPayload,
            } as ChatMessage);
          }

          if (phaseBreak) break; // tool 循环里如果触达上限，跳出 phase 循环
          // 不 phaseBreak：继续 while 循环，让模型基于 tool 结果继续生成
        }
      }

      // 6. 最终消息：phase 循环里已经落库了所有 assistant 输出（纯文本或带 tool_calls）。
      //    找最后一条 assistant 消息作为 done 事件的 message；如果都落库了 tool_calls 没 stop，
      //    给个兜底 assistant 消息。
      const historyFinal = await this.chat.listMessages(convo.id, user.id);
      let finalAssistant = [...historyFinal].reverse().find((m) => m.role === "assistant");
      if (!finalAssistant || (finalAssistant.content === "(工具调用)" && !finalAssistant.toolCalls?.length)) {
        finalAssistant = await this.chat.appendMessage(convo.id, "assistant", lastAssistantContent || "（无文本回复）");
      }

      emitTrace({
        type: hitBudget ? "agent.failed" : "agent.done",
        summary: hitBudget
          ? `⚠ agent 因预算打线中止  duration=${((Date.now() - snapshot.startedAt) / 1000).toFixed(1)}s  tokens=${snapshot.tokens}`
          : `✓ agent 完成  duration=${((Date.now() - snapshot.startedAt) / 1000).toFixed(1)}s  tokens=${snapshot.tokens}`,
        payload: hitBudget ? { reason: "budget" } : { tokens: snapshot.tokens },
      });

      await this.trace.finish(executionId, {
        status: hitBudget ? "budget" : "done",
        tokensUsed: snapshot.tokens,
        costYuan: snapshot.costYuan,
      });

      client.emit("done", { conversationId: convo.id, message: finalAssistant } satisfies ChatDonePayload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`send failed: ${msg}`);
      if (executionId) {
        emitTrace({ type: "agent.failed", summary: `✗ agent 崩溃: ${msg}` });
        await this.trace.finish(executionId, { status: "failed", error: msg, tokensUsed: snapshot.tokens });
      }
      client.emit("error", { conversationId: body?.conversationId, error: msg } satisfies ChatErrorPayload);
    }
  }
}
