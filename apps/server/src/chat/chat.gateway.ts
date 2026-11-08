import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
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
import { CapabilityService, type RouteResult } from "../capability/capability.service";

/** 单轮对话中「唯一工具 + 参数」调用上限，防死循环；重复调用走缓存不占预算 */
const MAX_TOOL_CALLS = 20;
/** 含重复调用在内的总步数硬上限：缓存短路不计数，但仍要防模型无限刷同一工具 */
const MAX_TOOL_STEPS = 40;

/** OpenAI 兼容接口要求 function.name 匹配 ^[a-zA-Z0-9_-]+$；
 *  操作目录原名带点号（mail.accounts.list），发模型前替换为下划线，回包再映射回原名。 */
const TOOL_NAME_INVALID = /[^a-zA-Z0-9_-]/g;

function buildToolApiNames(schemas: ToolSchemaDto[]): {
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
function sanitizeToolSequence(messages: ChatMessage[]): ChatMessage[] {
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
function toToolDefinition(schema: ToolSchemaDto, apiName: string): ToolDefinition {
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

/** 参数规范化：键排序后再序列化，避免 {a,b} 与 {b,a} 被当成两次不同调用 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/** 对话中枢 WS 通道：握手带 accessToken，事件流 send → started → (delta|tool|trace)×N → done */
@WebSocketGateway({ namespace: "/chat", cors: { origin: true, credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger("chat");
  /** 每个连接当前正在生成的请求；stop 事件/断线时中断 */
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly jwt: JwtService,
    private readonly chat: ChatService,
    private readonly llm: LlmAdapter,
    private readonly agents: AgentsService,
    private readonly registry: ToolRegistry,
    private readonly trace: TraceService,
    private readonly capability: CapabilityService,
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

  /** 断线即中止，避免后台仍消耗模型 token */
  handleDisconnect(client: Socket) {
    this.running.get(client.id)?.abort();
    this.running.delete(client.id);
  }

  /** 用户点「停止」：中断当前 SSE 流，已生成的部分文本由 onSend 收尾落库 */
  @SubscribeMessage("stop")
  onStop(@ConnectedSocket() client: Socket) {
    const ctrl = this.running.get(client.id);
    if (!ctrl) return;
    ctrl.abort();
    this.log.log(`stop requested by ${client.id}`);
  }

  @SubscribeMessage("send")
  async onSend(@ConnectedSocket() client: Socket, @MessageBody() body: ChatSendPayload) {
    const user = client.data.user as AuthUser | undefined;
    if (!user) return client.emit("error", { error: "unauthorized" } satisfies ChatErrorPayload);
    const content = (body?.content ?? "").trim();
    if (!content) return;

    const abort = new AbortController();
    this.running.set(client.id, abort);

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
      // 合法名 ↔ 原名映射：请求模型用 api 名，执行/落库/展示用原名
      const { apiToReal, realToApi } = buildToolApiNames(allToolSchemas);
      const apiNameOf = (real: string) => realToApi.get(real) ?? real;
      const realNameOf = (api: string) => apiToReal.get(api) ?? api;

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

      // 4b. 意图路由：廉价 LLM 调用判定相关模块，只下发这些模块的工具，把每轮输入从 ~33k 降到 ~6-10k。
      // Agent 模式保持用户配置的工具集（不路由），但仍检索能力片段增强上下文。
      const isDirect = !boundAgentId;
      let route: RouteResult = { kind: "general", modules: [] };
      let capabilityText = "";
      if (isDirect) {
        [route, capabilityText] = await Promise.all([
          this.capability.route(content),
          this.capability.retrieve(content, 6),
        ]);
      } else {
        capabilityText = await this.capability.retrieve(content, 4);
      }
      const routedModuleSet = new Set<string>();
      if (route.kind === "specific") route.modules.forEach((m) => routedModuleSet.add(m));

      // 直跑模式下裁剪工具集：只保留路由命中的模块 + 通用工具（site/web/health/chat）。
      // 「全站能做什么」类 general 问题只给通用工具 + 能力片段，模型靠检索内容回答，不再下发业务工具。
      if (isDirect) {
        const ALWAYS_MODULES = new Set(["site", "web", "health", "chat", "search"]);
        const filtered = new Set<string>();
        for (const name of agentTools) {
          const mod = name.split(".")[0];
          if (ALWAYS_MODULES.has(mod) || routedModuleSet.has(mod)) filtered.add(name);
        }
        // 兜底：路由全空时不裁剪，避免模型无工具可用
        if (filtered.size > 0) agentTools = filtered;
      }

      emitTrace({
        type: "agent.started",
        summary: `🧭 路由：${route.kind}${route.kind === "specific" ? `  modules=[${route.modules.join(",")}]` : ""}  tools=${agentTools.size}`,
        payload: { route: route.kind, modules: route.modules, tools: agentTools.size },
      });

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
      const baseMessages: ChatMessage[] = sanitizeToolSequence(history.map((m) => {
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
                function: { name: apiNameOf(tc.name), arguments: tc.arguments },
              })),
            } as ChatMessage;
          }
          return { role: "assistant", content: m.content } as ChatMessage;
        }
        return { role: "user", content: m.content } as ChatMessage;
      }));

      let toolCallsLeft = MAX_TOOL_CALLS;
      let toolStepsLeft = MAX_TOOL_STEPS;
      let hitBudget = false;
      let stopped = false; // 用户点「停止」/断线中断
      let streamedText = ""; // 当前这一轮流式已产出的文本（停止时落库）
      let lastAssistantContent = "";
      /** 本轮的「工具+参数 → 结果」缓存：重复调用直接复用，不占唯一调用预算 */
      const toolCache = new Map<
        string,
        { ok: boolean; data: unknown; error?: string; durationMs: number }
      >();

      // ═══ Phase 迭代器 ═══
      const phaseList: AgentPhase[] = usePhaseFlow ? phases : [{ name: "main", goal: "", tools: null }];

      // 跨 phase 累积的对话上下文（assistant/tool 消息都要带下去）
      const sharedMessages: ChatMessage[] = [...baseMessages];

      for (let phaseIdx = 0; phaseIdx < phaseList.length; phaseIdx++) {
        if (hitBudget || stopped) break;

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
        const phaseToolDefs: ToolDefinition[] = phaseSchemas.map((s) =>
          toToolDefinition(s, apiNameOf(s.name)),
        );

        // 5c. 构建 phase 专属 system prompt：注入检索到的能力片段（替代全量能力地图，省 token），
        //     并提示：如需完整模块清单可调 site.capabilities。
        const phasePersona = phase.goal
          ? `${personaPrompt}\n\n【当前阶段：${phase.name}】\n目标：${phase.goal}`
          : personaPrompt;
        const capSection = capabilityText
          ? `【站点能力参考（从知识库检索）】\n${capabilityText}\n\n如需查看全部模块清单，可调用 site.capabilities。`
          : "如需了解站点全部模块与入口，可调用 site.capabilities。";
        const systemContent = `${phasePersona}\n\n${capSection}`;

        // 5d. 本 phase 的 LLM messages：system(phase) + 已累积上下文
        // sharedMessages 跨 phase 保留工具调用/结果，否则进入下一 phase 时工具证据丢失，
        // 且只剩 tool 消息没有对应 tool_calls 会直接触发 400
        const llmMessages: ChatMessage[] = [
          { role: "system", content: systemContent },
          ...sharedMessages,
        ];
        const pushTurn = (m: ChatMessage) => {
          llmMessages.push(m);
          sharedMessages.push(m);
        };

        const phaseLabel = usePhaseFlow ? `[${phaseIdx + 1}/${phaseList.length}] ${phase.name}` : "main";

        emitTrace({
          type: "phase.started",
          summary: `▶ phase ${phaseLabel}  model=${phaseModel.provider}/${phaseModel.modelName}  tools=[${phaseToolNames.join(",") || "(none)"}]`,
          payload: { phaseIndex: phaseIdx, phaseName: phase.name },
        });

        // 5e. 本 phase 内部的生成 + 工具调用循环
        let phaseBreak = false;
        while (!phaseBreak && !stopped) {
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
          streamedText = "";
          let doneChunk: StreamChunk | null = null;

          try {
            for await (const chunk of this.llm.chatStream({
              endpoint: phaseModel.endpoint,
              apiKey: phaseModel.apiKey,
              model: phaseModel.modelName,
              messages: llmMessages,
              tools: phaseToolDefs,
              temperature: phaseModel.temperature,
              topK: phaseModel.topK,
              usageRef,
              signal: abort.signal,
            })) {
              if (chunk.type === "content") {
                fullText += chunk.delta;
                streamedText = fullText;
                client.emit("delta", { conversationId: convo.id, delta: chunk.delta });
              } else {
                doneChunk = chunk;
              }
            }
          } catch (e) {
            if (abort.signal.aborted) {
              stopped = true;
              this.log.log(`generation stopped by user in conversation ${convo.id}`);
              break;
            }
            throw e;
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
              pushTurn({ role: "assistant", content: fullText.trim() } as ChatMessage);
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
              // 落库存原名（可读），回放时再转回 api 名
              name: realNameOf(tc.function.name),
              arguments: tc.function.arguments,
            })),
          };
          const assistantWithTc = await this.chat.appendMessage(convo.id, "assistant", fullText.trim() || "(工具调用)", assistantMeta);

          // ⚠️ 关键：把带 toolCalls 的 assistant 消息 emit 给前端，让 groupMessages 能识别并渲染 ToolCallBlock
          client.emit("assistant", { conversationId: convo.id, message: assistantWithTc });

          // 回灌 LLM：assistant 消息（带 tool_calls）
          pushTurn({
            role: "assistant",
            content: fullText.trim(),
            tool_calls: toolCalls,
          } as ChatMessage);

          // 逐个 execute + emit trace + WS tool 事件 + 落库 tool 消息 + 回灌 tool 消息
          for (const tc of toolCalls) {
            if (abort.signal.aborted) {
              stopped = true;
              break;
            }
            // 总步数硬上限：即使重复调用走缓存，也要防止模型原地刷同一个工具
            if (toolStepsLeft-- <= 0) {
              this.log.warn(`tool call steps limit reached in conversation ${convo.id}`);
              emitTrace({
                type: "budget.hit",
                summary: `⚠ 工具调用步数达上限 ${MAX_TOOL_STEPS}（防死循环）`,
              });
              hitBudget = true;
              phaseBreak = true;
              break;
            }

            const args = safeParseArgs(tc.function.arguments);
            const realName = realNameOf(tc.function.name);
            const cacheKey = `${realName}:${stableStringify(args)}`;
            const cached = toolCache.get(cacheKey);

            let ok: boolean;
            let error: string | undefined;
            let toolPayload: string;
            let toolDuration = 0;

            if (cached) {
              // 重复调用同一工具同一参数：结果没变，直接复用；不执行、不占唯一预算。
              // 载荷里带 repeated 标记，提醒模型别再原地打转。
              ok = cached.ok;
              error = cached.error;
              toolPayload = JSON.stringify({
                repeated: true,
                note: "重复调用：参数与上次完全相同，已复用上次结果；请直接回答，不要再次调用",
                result: cached.ok ? cached.data : { ok: false, error: cached.error },
              });
              emitTrace({
                type: "tool.done",
                summary: `  ↳ ${realName} ↺ 复用上次结果（重复调用不计数）`,
                payload: { cached: true },
              });
            } else {
              if (toolCallsLeft-- <= 0) {
                this.log.warn(`tool call limit reached in conversation ${convo.id}`);
                emitTrace({
                  type: "budget.hit",
                  summary: `⚠ 唯一工具调用达上限 ${MAX_TOOL_CALLS}（防死循环）`,
                });
                hitBudget = true;
                phaseBreak = true;
                break;
              }

              const toolStart = Date.now();
              const result = phaseToolSet.has(realName)
                ? await this.registry.execute(
                    { userId: user.id, username: user.username, role: user.role },
                    realName,
                    args,
                  )
                : {
                    ok: false as const,
                    tool: realName,
                    error: `工具 ${realName} 不在 phase[${phase.name}] 的工具集内`,
                    durationMs: 0,
                  };
              toolDuration = Date.now() - toolStart;
              const toolOk = result.ok;
              const data = result.ok ? result.data : undefined;
              ok = toolOk;
              error = result.ok ? undefined : result.error;
              toolPayload = toolOk
                ? JSON.stringify(data)
                : JSON.stringify({ ok: false, error: result.error });
              toolCache.set(cacheKey, { ok: toolOk, data, error, durationMs: toolDuration });

              emitTrace({
                type: "tool.started",
                summary: `▸ [tool] ${realName}`,
                payload: { args },
              });

              if (toolOk) {
                emitTrace({
                  type: "tool.done",
                  summary: `  ↳ ${realName} ✓ ${toolDuration}ms`,
                  payload: { durationMs: toolDuration },
                });
              } else {
                emitTrace({
                  type: "tool.failed",
                  summary: `  ↳ ${realName} ✗ ${toolDuration}ms — ${error}`,
                  payload: { durationMs: toolDuration, error },
                });
              }
            }

            // DB 存纯 JSON，方便原生协议回灌；WS 事件 content 也用纯 JSON（前端可后续优化展示）
            const toolMessage = await this.chat.appendMessage(convo.id, "tool", toolPayload, {
              toolCallId: tc.id,
            });
            client.emit("tool", {
              conversationId: convo.id,
              name: realName,
              ok,
              error,
              durationMs: toolDuration,
              message: toolMessage,
            } satisfies ChatToolPayload);

            // 回灌 LLM：tool 消息（带 tool_call_id，匹配 assistant 的 tool_calls[i].id）
            pushTurn({
              role: "tool",
              tool_call_id: tc.id,
              content: toolPayload,
            } as ChatMessage);

            if (abort.signal.aborted) {
              stopped = true;
              break;
            }
          }

          if (phaseBreak) break; // tool 循环里如果触达上限，跳出 phase 循环
          // 不 phaseBreak：继续 while 循环，让模型基于 tool 结果继续生成
        }
      }

      // 5f. 用户主动停止：已产出的部分文本落库，done 带回该消息；trace 标记 aborted
      if (stopped) {
        emitTrace({
          type: "agent.aborted",
          summary: `■ 用户停止生成  duration=${((Date.now() - snapshot.startedAt) / 1000).toFixed(1)}s  tokens=${snapshot.tokens}`,
          payload: { reason: "user-abort", tokens: snapshot.tokens, cost: snapshot.costYuan },
        });
        if (executionId) {
          await this.trace.finish(executionId, {
            status: "failed",
            error: "用户停止生成",
            tokensUsed: snapshot.tokens,
            costYuan: snapshot.costYuan,
          });
        }
        const partial = streamedText.trim();
        if (partial) {
          const partialMessage = await this.chat.appendMessage(convo.id, "assistant", partial);
          client.emit("done", { conversationId: convo.id, message: partialMessage } satisfies ChatDonePayload);
        }
        return;
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
    } finally {
      // 只清理自己，避免误删同一连接上后续请求的 controller
      if (this.running.get(client.id) === abort) this.running.delete(client.id);
    }
  }
}
