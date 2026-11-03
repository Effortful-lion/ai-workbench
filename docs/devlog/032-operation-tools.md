# 032 · 操作目录生成 Agent Tool

- 日期：2026-11-03
- 状态：已完成

## 目标

把 `packages/shared/src/operations.ts` 的 120 条操作目录直接变成 AI 可调用工具，替换 13 个手写 `*.tools.ts`（54 个工具），做到 API / CLI / Tool 只有一份定义。

## 决策

- **工具名 = 操作 key**（如 `mail.messages.list`）：CLI 命令与工具名一一对应，排障时同一套词。
- **执行走本机 HTTP，不重复写业务**：工具 handler 以当前用户身份签发 2 分钟临时 JWT，回打 `http://127.0.0.1:${PORT}/api`。Controller 的 DTO 校验、`JwtAuthGuard`、`PermissionGuard`、IMAP 回写等全部复用，工具层零业务逻辑。
  - 否决「工具直接调 Service」：要手写 120 条 key→service 映射，等于第二份目录。
  - 否决「复用 WS 握手 token」：15 分钟过期，长会话中途会 401。
- **排除 auth / tools 两个模块**：`auth.register` 让 AI 自建账号、`auth.login` 换 token 均无意义且有风险；`tools.list` 只是工具清单本身。剩余 114 条全部暴露。
- **参数渲染改紧凑格式**：system prompt 里原来是整份 JSON Schema，114 个工具会膨胀到 4 万字符；改为 `folder:string(unread/q), limit:number` 一行式，mock 模型解析工具名的正则不受影响。
- **旧 Agent 容错**：库里存着旧工具名（`mail.list` 等）时，运行时过滤掉不存在项；过滤后为空则回落为「角色可见全部工具」，避免旧 Agent 变成哑巴。

## 实现

- `packages/shared/src/operation-tools.ts`（新增）：`operationToToolSchema` / `operationToolSchemas`，把 `OperationDef.params` 映射成 JSON Schema（path/query/body 拍平成同一对象，`risk=destructive` 写进描述）。
- `packages/shared/src/tool.ts`：`ToolContext` 增加可选 `username`。
- `apps/server/src/tools/tool-registry.service.ts`：新增 `register(def)`，供动态注册；同名保留先注册者。
- `apps/server/src/tools/operation-tools.service.ts`（新增）：`OnModuleInit` 注册 114 个工具；`buildRequest` 拆 path/query/body，未知参数按方法归位；错误取后端 `message`。
- `apps/server/src/tools/tools.module.ts`：providers 增加 `OperationToolsService`。
- `apps/server/src/chat/chat.gateway.ts`：执行工具时传 `username`；旧工具名容错。
- `apps/server/src/chat/agent-protocol.ts`：`compactArgs` 紧凑参数渲染。
- 删除 13 个 `*.tools.ts` 并从各自 Module 移除 provider：mail / models / notify / pipe / crm / commerce / schedule / code / projects / toolbox / resume / kb / chat。

## 验证

- 启动日志：`registered 0 tools` + `registered 114 operation tools from catalog`。
- `GET /api/tools`（owner）返回 114 条，含 `mail.accounts.list … mail.sync`。
- WS 直跑（`modelId` = 豆包 `doubao-seed-2-0-lite-260428`）问「我最新的邮件内容是什么？」：
  - trace：`tools=[…114 个…]` → `LLM 请求工具 mail.messages.list` → `tool.done ✓ 14ms` → 纯文本收尾。
  - 回复引用真实邮件：「[AI 工作台] SMTP 联调测试」，并顺带总结了第二封 `[SiftOps]` 故障通知。
- `pnpm --filter @aiwb/shared build && pnpm --filter @aiwb/server build` 通过。

## 遗留

- 列表类工具（`mail.messages.list`）返回全量字段含正文，邮件多时回灌会偏大；后续加 `limit` 或结果裁剪。
- 文件上传（`toolbox/items/upload`、`resume/import`）已由 034 以目录 `in:"file"` + multipart 补齐。
- 增强工具 `web.search` / `web.fetch` 已由 033 补齐（Bing 搜索 + 网页转文本）。
- 仍是 `▸TOOL` 文本协议，未切 OpenAI 原生 function calling。
