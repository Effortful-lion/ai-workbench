# 030 · 操作目录补齐：全站点 HTTP 接口

- 日期：2026-11-03
- 状态：已完成

## 目标

把 `aiwb` CLI 的操作目录从只有 mail 扩展到全站点，让 `aiwb operations` 覆盖除 multipart 上传外的全部 HTTP 接口。

## 决策

- **目录仍未单一定义来源**：只改 `packages/shared/src/operations.ts`，不动 controller / service / CLI；CLI 自动从 `OPERATIONS` 生成命令树。
- **key 沿用 mail 的资源前缀风格**：`<module>.<resource>.<action>`，如 `projects.docs.list`、`code.repos.list`、`notify.notifications.list`；模块级动作直接 `<module>.<action>`，如 `kb.search`、`schedule.upcoming`。
- **risk 按规则映射**：GET → `read`；POST/PATCH/PUT → `write`；DELETE 与 `commerce.seed` / `crm.seed` → `destructive`。
- **权限照抄 `@RequirePerm` 字符串**：代码实际使用的是 `RequirePerm`（不是 `RequirePermissions`），目录里只登记真实出现的权限名；无守卫或公开接口省略 `permission`。
- **multipart 与 WS 跳过**：`toolbox.items.upload`、`resume.import` 需要文件上传，CLI 不支持；WS 的 `chat` 命名空间 `send` 不是 HTTP。`resume.parse` 虽在任务给的跳过清单中，但代码显示它是普通 JSON body（`{ text }`），本轮仍按清单跳过，待确认后可补登。

## 实现

- `packages/shared/src/operations.ts`：新增 17 组常量（`AUTH_OPERATIONS`、`TOOLS_OPERATIONS`、`MODELS_OPERATIONS`、`AGENTS_OPERATIONS`、`CHAT_OPERATIONS`、`KB_OPERATIONS`、`RESUME_OPERATIONS`、`TOOLBOX_OPERATIONS`、`PROJECTS_OPERATIONS`、`CODE_OPERATIONS`、`SCHEDULE_OPERATIONS`、`NOTIFY_OPERATIONS`、`COMMERCE_OPERATIONS`、`CRM_OPERATIONS`、`PIPE_OPERATIONS`、`STATS_OPERATIONS`、`HEALTH_OPERATIONS`），并与 `MAIL_OPERATIONS` 合并进 `OPERATIONS`。
- 共 119 条操作 / 18 个模块；无重复 key、无重复 `METHOD path`。

## 验证

- `pnpm --filter @aiwb/shared build`、`pnpm --filter @aiwb/cli build` 通过。
- `node apps/cli/dist/cli.js operations` 列出 18 个模块；`--module schedule / notify / commerce` 正常。
- 只读抽样全部 rc=0：`projects.list`、`schedule.tasks.list`、`notify.notifications.list`、`code.repos.list`、`models.list`、`kb.search --q 部署`、`agents.list`、`chat.conversations.list`、`resume.me.get`、`toolbox.items.list`、`commerce.plans.list`、`crm.customers.list`、`pipe.sops.list`、`stats.overview --days 7`、`tools.list`、`auth.me`、`health.check`。

## 遗留

- 文件上传接口（`toolbox.items.upload`、`resume.import`）与 WS 聊天发送未纳入目录；CLI 只支持 JSON 请求体，后续要加 `--file` 才能覆盖。`resume.parse`（纯 JSON）已补登，总数 120 条。
- `schedule` 的时间字段用 `json` 类型以同时兼容毫秒时间戳与 ISO 串，CLI 传 ISO 时需加引号。
