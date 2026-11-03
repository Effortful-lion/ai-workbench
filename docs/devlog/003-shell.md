# 003 · shell 对话中枢

- 日期：2026-11-02
- 状态：已完成

## 目标

一期核心资产：把"对话即入口"落成真实可用的三态 shell。

- 三态界面：A 对话态（hero）/ B 工作态（对话列 + 面板区）/ C 沉浸态（CLI 占位）。
- 对话通道：Socket.io `/chat` 流式收发，会话与消息落库，REST 读历史。
- 面板管理器：open / activate / close / ⤢ 全屏，ModelsPanel 收编为首个面板。
- ⌘K 命令面板：导航 / 动作 / AI 三类混排。
- CLI 占位：全屏等宽终端 + 基础命令集（help/whoami/open/theme/clear/exit）。

## 决策

1. **WS 用 Socket.io 而非裸 SSE**：CLI 交互、站内信通知后续都是双向通道，一次选型全覆盖；namespace `/chat` 与后续 `/cli` `/notify` 对齐总体设计 §5.2。
2. **握手鉴权放在 handleConnection**：JWT 校验 + `chat:use` 权限点在连接时一次完成；失败即发 `error` 事件并服务端 disconnect（浏览器 connect_error 不可靠，客户端以 `error`+`disconnect` 为准）。
3. **HTTP 守卫与 WS 握手共用 `@aiwb/shared` 的 hasPermission**：权限表只有一份，Tool Registry（模块 4）继续复用。
4. **消息流协议**：`send → started(含权威 userMessage+assistantMessageId) → delta×N → done(含落库 assistant 消息)`。前端本地回显用临时 id，`started` 到达后替换为服务端权威消息——不回显服务端已确认的重复内容。
5. **模型挑选策略**：指定 modelId > status=ok 的第一个 > 任意已接入模型；一个都没有则回错误提示引导去模型管理。`pickModel` 在 ChatService 而非 gateway，便于模块 4 的 Agent 执行器复用。
6. **mock:// provider**：endpoint 以 `mock://` 开头时适配层返回内置应答（流式逐字）。无真实 key 也能开发/演示/验证打字机效果，browser_use 自动化验证也靠它。chat() 与 chatStream() 双路支持。
7. **三态是派生状态而非路由**：`mode = cliOpen ? C : (currentId||pendingNew||panels) ? B : A`，不引入 React Router——面板态不进 history（总体设计 §5.3），刷新回到 A 是符合预期的。
8. **pendingNew 标记**：hero 发出首条消息的瞬间立即切到 B 态（不等 started），避免"输入框已空但还在首页"的迟滞感。
9. **CLI 不引 xterm.js（延期）**：模块 4 接 agent 真实流式输出时一并引入；当前用等宽 div + sr-only input 占位，命令集限定 §8.4 的四类。

## 实现

- 协议类型：[chat.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/chat.ts)（ConversationDto/MessageDto/WS 事件载荷）。
- 表结构：[schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts) 新增 conversations / messages（cascade 删除）。
- 流式适配：[llm.adapter.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/llm/llm.adapter.ts) `chatStream()` 解析 OpenAI 兼容 SSE（`data:` 行、`\n\n` 分帧、[DONE] 终止）。
- 服务端 chat 模块：[chat.gateway.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/chat/chat.gateway.ts)（WS 收发）、[chat.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/chat/chat.service.ts)（会话/消息/挑模型，越权访问一律 404）、[chat.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/chat/chat.controller.ts)（REST 历史，`@RequirePerm("chat:use")`）。
- 前端通道：[socket.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/lib/socket.ts) + [stores/chat.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/chat.ts)（socket 生命周期、本地回显、流缓冲、会话 CRUD）。
- 状态管理：[stores/panel.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/panel.ts)（面板管理器）、[stores/ui.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/ui.ts)（主题持久化，CLI/⌘K 开关不持久化）。
- Shell 组件：[TopBar](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/TopBar.tsx)、[StatusBar](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/StatusBar.tsx)（tmux 风：态标/路径/llm/ws/时钟）、[HeroState](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/HeroState.tsx)（时间感知招呼语 + 模型在线数 + chips）、[ChatColumn](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/ChatColumn.tsx)（历史抽屉 + 打字机 ▌）、[PanelZone](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/PanelZone.tsx)（tabs + ⤢ + 占位面板）、[CommandPalette](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/CommandPalette.tsx)（↑↓/⏎/esc + AI 兜底）、[CliOverlay](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/CliOverlay.tsx)。
- 布局装配：[App.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/App.tsx) 重写为三态派生 + ⌘K 全局监听；[index.css](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/index.css) 增加网格底纹 / blink / 细滚动条。

## 验证

- REST：`GET /api/chat/conversations` 空列表 → WS 发消息后读到会话与 2 条消息；无 token 401；越权读他人会话 404（service 层 and(eq id, eq userId)）。
- WS：node 脚本全链路 —— `started(model=mock-1) → 201 个 delta → done`，落库内容与流式字节数一致（201=201）；坏 token 收到 `{error:"unauthorized"}` 并被服务端断开。
- 浏览器（browser_use，两轮共 16 项全 PASS）：登录 → A 态招呼语/chips/状态栏 [A·对话] → 发消息切 B 态打字机（状态栏 [B·工作] + llm: mock/mock-1）→ ⌘K 打开模型管理面板 → 面板 ⤢/关闭 → 历史抽屉含会话「你好」→ ⌘K 进 CLI（[C·cli]）→ whoami/help/theme warm/theme dark/open models 全通 → ⌘K 无匹配时「问 AI」兜底进入对话流。
- 类型：`tsc --noEmit` 全绿（补了 vite-env.d.ts 声明 CSS side-effect import）。

## 遗留

1. 对话区是纯文本渲染，多模态媒体块（图片/视频/代码高亮）未实现——等 agents 产出 tool 结果时按总体设计媒体块方案做。
2. CLI 是占位终端：无 xterm.js、无 agent 命令、无流式输出，模块 4 一并升级。
3. accessToken 15 分钟过期后 WS 不会自动重连换新 token（REST 有 401 自动续期，WS 暂无）；表现为挂机后发送失败，刷新页面恢复。后续在 socket `error` 分支接 refresh。
4. ⌘K 命令表是静态的；模块能力注册后（Tool Registry）应动态生成"动作"类命令。
5. 会话标题取首条消息前 24 字，后续可让 LLM 起标题。
6. PanelZone 全屏态没有 esc 快捷键退出（只能点 ⤡）。
