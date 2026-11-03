# 004 · agents + Tool Registry

- 日期：2026-11-02
- 状态：✅ 完成（curl 权限矩阵 + node WS 端到端 + 浏览器三轮验证全 PASS）

## 目标

落地全架构核心「能力即工具」：Tool Registry 统一收集模块能力并按角色过滤；agents 模块让
用户把「人设 prompt + 工具子集」封装为可对话的 Agent；对话通道支持 Agent 绑定与工具调用闭环。

## 决策

1. **@RegisterTool 装饰器 + DiscoveryService 扫描**：任何模块 provider 的方法标注即注册，
   启动时生成 Tool Schema 清单；Registry 设为 @Global，避免模块间循环依赖。
2. **指令式工具调用协议（一期）**：LLM 单独输出一行 `▸TOOL {"name","args"}` 即发起调用。
   单行指令便于流式解析（网关按行缓冲，指令行不下发、不落库）；OpenAI 原生 function
   calling 留作二期。mock:// 适配器实现 Agent 模式：消息提及工具名即产出指令行，收到
   【工具结果】后转述——无 key 也能演示完整闭环。
3. **三重权限兜底**：创建 Agent 时校验 tools ⊆ 创建者权限；会话注入时过滤
   agent.tools ∩ 用户实时权限；Registry.execute 内 hasPermission 再校验一次。
4. **Agent 绑定在会话创建时**：`ChatSendPayload.agentId` 仅新会话生效，落 conversations.agentId；
   切换 Agent = 开新会话（前端 startAgentChat），语义干净。
5. **工具结果即消息**：每次工具执行落一条 role=tool 消息（`▸TOOL name ✓ ms + JSON`），
   WS 新增 `tool` 事件推给前端渲染虚线块；历史回看与实时流内容一致。

## 实现

- shared：`ToolSchemaDto`（handler 不出网）、`AgentDto/UpsertAgentInput`、
  `ChatSendPayload.agentId`、`ChatStartedPayload.agentId`、`ChatToolPayload`。
- server/tools：register-tool.decorator、ToolRegistry（扫描/过滤/执行）、
  ToolsController（GET /api/tools 按角色过滤）、ToolsModule(@Global + DiscoveryModule)。
- 首批工具：models.list / models.test（models.tools.ts）、chat.listConversations（chat.tools.ts），
  与 REST 控制器共用同一 service 层。
- server/agents：agents 表（owner_id/name/persona_prompt/tools_json）+ CRUD REST，
  越权访问返回 404/拒绝；工具子集校验（未知工具/超权限均 400）。
- chat 通道：Agent 会话注入 system prompt（人设+工具清单+调用规则，agent-protocol.ts），
  生成循环上限 MAX_TOOL_CALLS=3，协议行按行缓冲剔除。
- llm.adapter：mockReply 双模式（普通介绍 / Agent 演示）。
- web：AgentsPanel（卡片+创建/编辑+工具勾选+「▸ 对话」）、stores/agents、
  对话栏头 Agent 下拉、tool 消息虚线块渲染、PanelZone 接线。

## 验证

- curl：owner/member /tools 均 3 项；无 token 401；未知工具 400「未知工具: kb.search」。
- node WS：Agent 会话发「models.list」→ started(agentId) → tool(models.list ✓ 真实查库)
  → done（转述含 3 个模型）；落库 user/tool/assistant 三角色正确、无协议行。
- 回归：无 Agent 普通对话 started/done 正常，agentId=null。
- 浏览器：AgentsPanel 卡片/工具标签/◐ 3 tools 渲染 ✓；「▸ 对话」栏头选择器同步 ✓；
  发送后 tool › 虚线块 + ai › 总结同屏 ✓。（中途一次 FAIL 查明为测试脚本未按回车，非产品 bug。）

## 修复记录

- ToolRegistry 扫描到 Nest 内部 provider 的 getter（HttpAdapterHost.listen$）在原型上直接
  访问会抛错 → 改用 getOwnPropertyDescriptor().value 取方法，不触发 getter。
- server 启动 cwd 必须是 apps/server（DB 路径相对解析），从仓库根启动会拿到空库导致登录 500。

## 遗留

- OpenAI 原生 function calling（真实模型下更稳的工具调用）二期增强。
- ⌘K 工具命令动态化（把 /api/tools 混排进命令面板）未做，等更多工具注册后再上。
- 工具调用中途的「正在调用 xxx」实时状态（当前工具块在执行完成后才出现）。
- CLI 内 `agent run` 沉浸流式输出（随 xterm.js 一起做）。
