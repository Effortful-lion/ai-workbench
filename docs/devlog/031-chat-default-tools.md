# 031 · 对话直跑模式接入工具

- 日期：2026-11-03
- 状态：已完成

## 目标

不绑定 Agent 的普通对话也能调用工具，解决「问『我最新的邮件内容是什么』，AI 回答我没有权限访问邮箱」的问题。

## 决策

- **直跑模式默认放行全部工具**：以前只有绑定 Agent 才注入工具清单，未绑定 = 工具集为空，system prompt 直接写「你没有可调用的工具」，模型只能道歉。现在未绑定 Agent 时按角色把 `registry.listForRole(role)` 全部加入工具集。
- **默认人设兜底**：直跑模式也要有 system prompt，否则连工具清单都不会注入；给一句最小人设「你是 AI 工作台里的一个 Agent，可以调用系统工具完成任务」。
- **不强制换模型**：问题不在模型能力，而在提示词里没有工具。`pickModel` 仍保持原逻辑（默认挑 `status=ok` 的第一个，可能还是 mock）；用户在 UI 选的真实模型（豆包 / DeepSeek）现在能正常发起工具调用。

## 实现

- `apps/server/src/chat/chat.gateway.ts`：
  - `personaPrompt` 由 `string | null` 改为始终有值的 `string`，Agent 绑定存在时用其人设覆盖。
  - Agent 未绑定或工具集为空时，`allToolSchemas.forEach(t => agentTools.add(t.name))`。
  - `phaseSystemPrompt` 不再判空，始终 `buildAgentSystemPrompt(phasePersona, phaseSchemas)`。

## 验证

- WS 直跑（`/chat` 命名空间，`modelId` 指向真实豆包 `doubao-seed-2-0-lite-260428`）发送「我最新的邮件内容是什么？」：
  - trace：`tools=[…54 个…]` → `LLM 请求工具 mail.list` → `tool.done mail.list ✓ 3ms` → `LLM 请求工具 mail.read` → `tool.done mail.read ✓ 2ms` → 纯文本收尾。
  - 回复基于真实数据：「发件人：QQ 邮箱…主题：[AI 工作台] SMTP 联调测试…已标记为已读」。
- 对照：同一问题在 `mock-1` 下只返回 mock 提示文本，不会调用工具（符合预期，mock 无决策能力）。

## 遗留

- 直跑模式一次性注入全部工具，system prompt 变大；工具清单已由 032 改为「操作目录生成的 114 个工具 + 紧凑参数渲染」。
- 真实 function calling（OpenAI tools 字段）仍未启用，当前是自定义 `▸TOOL` 文本协议。
- 工具执行结果里 `mail.list` 默认只给最新若干封，未做分页参数。
