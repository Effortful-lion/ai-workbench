# 052 · 修复工具消息序列导致的多轮 400

- 日期：2026-11-06
- 状态：已完成

## 问题
`介绍该应用可以做些什么？` 这类会触发工具的问题，报：

```
LLM 400: Messages with role 'tool' must be a response to a preceding message with 'tool_calls'
```

即请求体里出现了 `role: "tool"` 消息，但它前面没有对应的 `assistant(tool_calls)`。这一轮之后，只要该会话继续使用工具就会被拒。

## 根因
1. **跨 phase 上下文被重置**：`llmMessages` 在每个 phase 内用 `baseMessages` 重新拼装，上一 phase 的 `assistant(tool_calls)` 没带下去，只剩 tool 消息（或反过来），序列断裂。
2. **历史回放缺少兜底**：中断的请求、时间戳并列导致的排序抖动，都会在 DB 里留下孤立 tool 消息；回放时原样发给模型。
3. **旧数据降级不彻底**：无 meta 的 tool 消息已降级为 user，但「assistant 有 tool_calls 却没落 tool 回应」的情况没有处理。

## 决策
1. **发送前统一重建序列**（`sanitizeToolSequence`）：以 `assistant.tool_calls[].id` 为准配对 tool 消息——配对成功则紧跟其后插入；找不到回应补一条「工具未执行（历史记录缺失）」占位；配不上任何 tool_calls 的 tool 消息直接丢弃。任何畸形历史都不会再让整轮请求失败。
2. **跨 phase 共享上下文**：新增 `sharedMessages`，每个 phase 用 `system + sharedMessages` 组装，assistant/tool 消息通过 `pushTurn` 同时写入当前 phase 和共享上下文。
3. 不改数据库结构（不加 seq 列）：重建序列比保证插入顺序更稳，也不会影响已有数据。

## 实现
- [chat.gateway.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/chat/chat.gateway.ts#L60-L91)：新增 `sanitizeToolSequence()`。
- [chat.gateway.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/chat/chat.gateway.ts#L253-L282)：`baseMessages` 在从 DB 还原后立即过一遍 sanitize。
- [chat.gateway.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/chat/chat.gateway.ts#L288-L326)：新增 `sharedMessages` 与 `pushTurn()`，替换原来的 `baseMessages` 拼接与两处 `llmMessages.push`。
- 纯文本收尾的 assistant 消息也写入共享上下文，保证下一 phase 能看到上一阶段的结论。

## 验证
用 socket.io 客户端以 `deepseek-flash` 跑**同一会话两轮**：

1. 第一轮「介绍该应用可以做些什么？」
2. 第二轮「现在帮我看下今天的邮件摘要」

结果：两轮均正常返回；第二轮依次调用 `mail.digest`、`mail.messages.list` ×3，输出 1308 字的真实邮件摘要（含今日到期提醒、SiftOps 诊断、44 封退信分析）。未再出现 tool 序列 400。

## 遗留
- 占位 tool 回应会让模型看到「工具未执行」，属于有损降级，但优于整轮报错。
- 根因（时间戳并列排序）未从写入侧消除；若后续出现大量并列，可给 messages 表加自增 seq（需要迁移）。
