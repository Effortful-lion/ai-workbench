# 037 · 原生 Function Calling

- 日期：2026-11-03
- 状态：✅ 已完成（后端原生 FC + 前端 ToolCallBlock 可视化 + 端到端验证通过）

## 目标

把 AI 工具调用从自定义 `▸TOOL` 指令协议切到 OpenAI 兼容的原生 function calling。让模型直接在 API 请求里带 tools schema、响应里给 tool_calls，不再靠正则切指令行。

验收：Gateway 传 tools 参数 → LlmAdapter 解析流式 tool_calls 增量 → 按 finish_reason 分流 → 原生 tool/assistant 消息格式回灌 → buildContext 还原完整历史。

## 决策

- **tools 放请求体**：不再塞 system prompt（省掉"工具名 — 参数: xxx"这类文本描述），原生协议更紧凑、更准。
- **tool_calls 流式增量拼接**：OpenAI 兼容 SSE 的 tool_calls 是按 index 分块吐出的（每个 delta 可能只补一个 JSON 字符），Gateway 攒完 arguments 再执行。
- **StreamChunk 替代 string 增量**：原来 `chatStream` 只 yield string（纯文本）。改成 yield `{type:"content",delta}` 和 `{type:"done",finishReason,toolCalls}` 两种块，Gateway 按类型分流。
- **DB messages 加 meta JSON**：assistant 消息带 tool_calls 数组，tool 消息带 tool_call_id；纯 content 继续存在 content 列，meta nullable 不破坏旧数据。
- **buildContext 还原原生格式**：DB 读回 MessageDto 后，assistant 带 toolCalls → `{role:"assistant", content, tool_calls}`；tool 带 toolCallId → `{role:"tool", content, tool_call_id}`；旧指令式 tool 消息（无 meta.toolCallId）降级成 user 提示文本 `【工具结果】...`。
- **mock:// 模式优先原生**：不再看 system prompt 里有没有 `▸TOOL`，直接看请求体有没有 tools 参数；有 tools → 按原生格式返回 `finish_reason:"tool_calls"` + tool_calls 数组。
- **废弃但保留文件**：agent-protocol.ts 的 parseToolCalls / stripDirectives / buildAgentSystemPrompt 标记 deprecated，buildAgentSystemPrompt 只留人设（工具清单交给原生 tools 参数）。

## 实现

- `apps/server/src/db/schema.ts`：messages 加 `meta text json nullable`，type 声明 toolCalls / toolCallId。
- `apps/server/src/chat/chat.service.ts`：`toMessageDto` 解析 meta → MessageDto 扩展 toolCallId / toolCalls；`appendMessage` 接收可选 meta；`buildContext` 直接返回 MessageDto[]（带 meta）。
- `packages/shared/src/chat.ts`：MessageDto 加 `toolCallId?` / `toolCalls?`；新增 ToolCallRef 类型。
- `apps/server/src/llm/llm.adapter.ts`（重写）：
  - ChatMessage 加 tool role、assistant 加 tool_calls、tool 加 tool_call_id。
  - 新增 ToolDefinition / ToolCallDef / StreamChunk / ToolFunctionDef 类型。
  - chat / chatStream 加 tools 参数 → 请求体带 `tools: [{type:"function",function:{...}}]`。
  - SSE 解析同时处理 delta.content 和 delta.tool_calls（按 index 累计 arguments）；收集 finish_reason；最后 yield done chunk 带完整 toolCalls。
  - mockReply 优先看 tools 参数，按原生格式返回。
- `apps/server/src/chat/chat.gateway.ts`（重写核心循环）：
  - buildAgentSystemPrompt(phasePersona, []) → 只传人设。
  - chatStream 加 tools=phaseToolDefs 参数。
  - 循环内按 StreamChunk.type 分流：content → emit delta；done → 看 finishReason。
  - `finish_reason === "tool_calls"`：拿到完整 toolCalls → 落库 assistant(带 toolCalls meta) → 逐个 execute → 落库 tool(带 toolCallId meta) → 回灌 LLM（assistant tool_calls + N 条 tool）。
  - 循环不再 parseToolCalls / stripDirectives，不再构建 `▸TOOL xxx ✓ ...` 文本；tool 消息 DB 存纯 JSON，WS ChatToolPayload.content 也用纯 JSON。
  - baseMessages 从 MessageDto[] 还原原生 ChatMessage 格式（tool role + tool_call_id，assistant + tool_calls）。
- `apps/server/src/chat/agent-protocol.ts`：瘦身，导出 deprecated stub。

## 验证

- `pnpm --filter @aiwb/shared build` / `@aiwb/server build` / `@aiwb/cli build` 全部通过（tsc + nest build 无错）。
- 后端启动（之前成功）：116 operation tools 注册 + 2 web tools；ChatGateway subscribed to "send"。
- DB schema 迁移：drizzle-kit push 成功给 messages 加 meta 列（nullable，旧数据不受影响）。
- **端到端 WS 验证**因 shell 会话不常驻（后端进程随 shell 退出被杀）而未完成；代码路径：mock:// 工具名触发 → 原生 tool_calls 返回 → Gateway execute → tool role 回灌 → 模型继续生成。

## 验证

- `pnpm --filter @aiwb/shared build` / `@aiwb/server build` / `@aiwb/cli build` 全部通过（tsc + nest build 无错）。
- DB schema 迁移：drizzle-kit push 成功给 messages 加了 meta 列（nullable，旧数据不受影响）。
- **LlmAdapter mock:// 原生协议测试**（直接 new LlmAdapter 实例，绕过 Nest DI）：
  - ✅ 带 tools 参数 + 提示里提到 "mail" → `finishReason="tool_calls"` + `toolCalls=[{id, type:"function", function:{name:"mail.messages.list", arguments:"{}"}}]`
  - ✅ 不带 tools + 普通提示 → `finishReason="stop"` + 正常文本输出（逐字符流式 content delta）
  - ✅ StreamChunk 两种类型正确产出：`{type:"content", delta}` 逐字流式 + `{type:"done", finishReason, toolCalls, usage}` 完整收尾
  - ✅ `finish_reason` 为 `null` 时不再被 `if (choice?.finish_reason)` 挡住（已改为 `!== undefined`）
- **Gateway 协议修补**：`handleConnection` token 取法增加 `handshake.query.token` fallback（Socket.IO polling transport 下 auth token 在 Engine.IO query 里，WebSocket 下通常放在 handshake.auth 里）。
- **Socket.IO polling 链路打通到 Gateway 前**：Engine.IO 握手 → Socket.IO `40/chat` 命名空间握手 → `42["send", {...}]` 事件发送，全部返回 ok（unauthorized 问题在加 query token fallback 后已定位）；GET 长轮询收事件因需要 Gateway 完整跑完一次 tool_call + execute + tool role 回灌而需要后端常驻，在当前 shell 会话下未能完成。

## 完整端到端验证（mock:// Gateway WS）

```
send → started(userMessage)
  → assistant(role=assistant, toolCalls=[{id, name, arguments}])  ← 新增 WS 事件
  → tool(role=tool, toolCallId)                                   ← 逐个工具结果
  → done(role=assistant, content)                                  ← 最终回复
```

DB 三条消息正确落库：
```
role=assistant content="(工具调用)" meta={toolCalls:[{id, name, arguments}]}
role=tool      content="[...]"     meta={toolCallId: "xxx"}
role=assistant content="自然语言"   meta=null
```

### 真实豆包原生 FC 验证
- 豆包生成 `call_x5vqgizf4us6c8u159tv9qex`（原生 tool_call_id）
- Gateway execute `mail.digest` → 豆包自然语言解读（Markdown 表格）
- DB meta 列存完整原生格式

## 前端 ToolCallBlock 可视化

### 组件
- `apps/web/src/features/chat/ToolCallBlock.tsx`：`groupMessages` 分组算法 + `ToolCallBlock` 组件 + `prettyJson` 美化 + `resultSummary` 摘要
- `apps/web/src/shell/ChatColumn.tsx`：`useMemo(groupMessages)` → `groups.map` 渲染，`kind:"tool-call"` 渲染折叠块

### 后端缺失事件（关键 Bug）
**问题**：Gateway 在原生 tool_calls 分支里落库 assistant(带 toolCalls meta) 后，没有 emit 任何 WS 事件告诉前端——前端 ChatStore 只通过 `started`/`tool`/`done` 三个事件塞消息进 messages 数组，中间那条 assistant(toolCalls) 完全丢失。`groupMessages` 扫描时永远找不到能触发折叠块的消息。

**修复**：
1. `packages/shared/src/chat.ts`：新增 `ChatAssistantPayload { conversationId, message }`
2. `apps/server/src/chat/chat.gateway.ts`：落库 assistant(toolCalls) 后立即 `client.emit("assistant", {...})`
3. `apps/web/src/stores/chat.ts`：加 `socket.on("assistant", ...)` 监听，塞 messages

### 浏览器验证 PASS ✅
- ▸/▾ 折叠切换图标 ✅
- `tool mail.accounts.list` 工具名称 ✅
- `✓` 成功状态标记 ✅
- `( {} )` 参数摘要 ✅
- 展开后 `// arguments {}` + `// result [...]` 完整 JSON ✅
- 位置：`user message → tool block → ai reply` ✅
- Console 干净，无 error/warning ✅

## 遗留

- ~~**需要后端常驻后做完整 Gateway 端到端**~~ ✅ 已通过（mock:// + 真实豆包）
- ~~前端 UI 改动~~ ✅ ToolCallBlock 已实现并通过浏览器验证
- ~~后端缺失 assistant WS 事件~~ ✅ 已修复
- assistantMessageId 在 ChatStartedPayload 里仍是占位 randomUUID()，前端可能忽略（done 事件才是真正的消息）；后续可优化为实际落库的 id。
- 旧指令式 tool 消息（无 meta.toolCallId）降级成 user 提示文本后，混合了原生协议 + 指令式的历史会比较怪；可以在迁移脚本里把旧 tool 消息转成带 meta 的格式。
- 前端 TracePanel 已有 trace.tool.started/done 事件 → 可以和 ToolCallBlock 联动显示 pending 状态（当前 ToolCallBlock 显示 pending 但没有和 trace 事件联动更新）。
- 多工具并行调用（同轮 assistant 给多个 tool_calls）的折叠块渲染——理论上 groupMessages 已支持，但需要真实多 tc 场景验证。
