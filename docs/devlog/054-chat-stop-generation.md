# 054 · 主聊天页停止生成

- 日期：2026-11-06
- 状态：已完成

## 目标

050 只给知识库问答加了「停止」，主聊天（ChatColumn）仍无法中断 AI 输出。补齐端到端停止：点按钮后立刻停、已输出内容保留、服务端不再继续烧 token。

## 决策

- **WS 事件 `stop` + 服务端 AbortController**，而不是前端只断开/忽略：只有断开 SSE 才能真正止损，否则模型仍会在后台跑完并落库。
- **已生成片段落库**：停止时把当前这一轮流式累积文本存成 assistant 消息，前端刷新后与停止瞬间看到的文本一致。
- **无文本时不发 `done`**：若停止发生在首 token 前（或工具执行中），服务端不补空消息，前端保留本地状态，避免出现「（无文本回复）」等噪音。
- **放弃新增 execution 状态**：trace 用 `agent.aborted` 事件表达停止，执行记录仍写 `failed` + error「用户停止生成」，不改 DB 状态枚举。

## 实现

- [llm.adapter.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/llm/llm.adapter.ts#L287-L299)：`chatStream` 新增 `signal`，与超时信号 `AbortSignal.any` 合并；mock 逐字符循环也检查中止。
- [chat.gateway.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/chat/chat.gateway.ts#L153-L166)：连接级 `running` Map 存 AbortController；新增 `stop` 消息与 `handleDisconnect` 中断。
- 同一文件：流式循环包 try/catch，`aborted` → `stopped`；phase/工具循环短路；收尾处落库部分文本、emit `done`、trace `agent.aborted`；`finally` 只清理自己的 controller。
- [chat.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/chat.ts#L199-L219)：`stop()` 本地立即停止 + 保留片段（`local-stopped`），`done` 到达时用服务端消息替换；`delta` 在非 streaming 状态忽略。
- [ChatColumn.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/ChatColumn.tsx#L253-L264)：输出中输入框右侧显示红色「■ 停止」。
- [TracePanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/chat/TracePanel.tsx)：新增 `agent.aborted` 的颜色/图标/层级映射。
- [agents.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/agents.ts#L66-L78)：`TraceEventType` 增加 `agent.aborted`。

## 验证

- shared / server / web 构建均通过。
- 真机 WS 测试（admin，deepseek-flash，2000 字长文）：首 token 后 1s 发送 `stop` → **3ms 收到 done**，已流式 230 字，落库 230 字，完全一致。
- 停止发生在首 token 前：服务端中止且不发空消息，前端立即恢复输入态。

## 遗留

- 工具正在执行时无法被 AbortController 打断（`registry.execute` 不支持 signal），会等当前工具返回后停止；工具一般 <1s，可接受。
