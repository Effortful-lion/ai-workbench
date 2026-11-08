# 051 · 修复工具名非法导致 LLM 400

- 日期：2026-11-06
- 状态：已完成

## 问题
聊天只要带上工具就报：

```
LLM 400: Invalid 'tools[0].function.name': string does not match pattern.
Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'.
```

操作目录的 key 是点号分层（`mail.accounts.list`、`kb.documents.ingest`…），共 116 个工具，全部以 `mail.accounts.list` 这类形式直接拼进 `tools[].function.name`。OpenAI 兼容接口（含豆包、DeepSeek）只接受 `^[a-zA-Z0-9_-]+$`，于是整个请求被拒——不是某个工具失败，而是所有工具都不可用。

## 决策
1. **只在「发给模型」的边界改写名字**：`mail.accounts.list` → `mail_accounts_list`（非 `[a-zA-Z0-9_-]` 字符换成下划线），不改操作目录、不改注册表、不改前端展示。
2. **保留双向映射**：模型回包里的 api 名映射回原名再执行工具、再落库/推送，因此会话记录、Trace 面板、工具事件里看到的仍是可读的点号名。
3. **历史回放同样转换**：库里存原名，构造上下文时再转回 api 名，否则历史消息再次触发 400（这是最容易漏的一处）。
4. **碰撞兜底**：`a.b` 与 `a_b` 会撞名，撞了就追加 `_` 后缀（当前目录无碰撞，仅作保护）。
5. 不改用「提示词里告诉模型调 CLI」的方案：native function calling 已通，改提示词会牺牲可靠性。

## 实现
- [chat.gateway.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/chat/chat.gateway.ts#L179-L202)：新增 `TOOL_NAME_INVALID` / `buildToolApiNames()` / `toToolDefinition(schema, apiName)`。
- [chat.gateway.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/chat/chat.gateway.ts#L147-L152)：构建 `apiToReal` / `realToApi` 与 `apiNameOf` / `realNameOf`。
- 历史回放、phase 工具定义、工具执行、assistant meta 落库、`tool` 事件统一走映射；`phaseToolSet` 判断用原名，`registry.execute` 用原名。
- [llm.adapter.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/llm/llm.adapter.ts)：mock 模型的工具名匹配从 `split(".")` 改为 `split(/[._]/)`，兼容两种写法。

## 验证
`nest build` + 重启，用 socket.io 客户端以真实模型跑端到端：

- `deepseek-flash`：模型正确选择 `mail_accounts_list` → 服务端映射回 `mail.accounts.list` → 工具成功执行 → 返回真实邮箱账户表格（1 个 QQ 邮箱、52 封邮件）。
- `doubao-seed-2-0-lite`：不再出现 tools 400，改为该账号自身的 `AccountOverdueError`（403 欠费），与本改动无关。
- mock 模型：直接列出全部 116 个合法 api 名，无非法字符。

## 遗留
- 豆包模型当前账号欠费，需充值或在 UI 切到 deepseek-flash；不影响本次修复。
- 工具名长度未截断（合法上限 64 字符），当前最长名字远低于该值，暂不处理。
