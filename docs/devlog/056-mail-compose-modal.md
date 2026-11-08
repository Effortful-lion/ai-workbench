# 056 · 邮件可视化写邮件弹窗

- 日期：2026-11-06
- 状态：已完成

## 目标

原写邮件只有 `mail.compose <to> <subject> | <body>` 命令式输入，操作成本高，也无法选择发件邮箱。改为可视化弹窗：收件人 / 主题 / 正文 + 发件邮箱下拉（来自账户管理），每个账户用自己的 SMTP 发信。

## 决策

- **复用后端已有的 `POST /mail/messages`**：`MailService.compose` 早已支持 `accountId`，通过 `resolveAccount(userId, id)` 选账户；未传时仍取第一个账户。前端只需把下拉选中的 id 带上，无需改后端。
- **单收件人**：后端 `normalizeAddress` 只接受单个合法邮箱（`EMAIL_RE` 不含逗号），本期不扩成多收件人，避免改动 API 契约。
- **保留命令式**：`mail.compose` / `mail.draft` 命令继续可用，弹窗只是新入口，不替换旧路径。
- **无账户时禁用入口**：按钮 `disabled` + title 提示先去「邮箱账户」注入，避免打开空弹窗。

## 实现

- [MailPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/mail/MailPanel.tsx#L128-L144)：新增 compose 弹窗状态，Esc 关闭。
- 同文件 [L329-L372](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/mail/MailPanel.tsx#L329-L372)：`openCompose()` 默认选中第一个账户；`submitCompose(draft)` 校验收件人/主题后 POST，成功切到 sent/drafts 并选中新邮件。
- 同文件 [L628-L740](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/mail/MailPanel.tsx#L628-L740)：弹窗 UI —— from 下拉显示 `名称 <地址>`（连接异常标注）、to、subject、body，底部显示将使用的 `smtpHost:smtpPort`，「存草稿」「⏎ 发送」，遮罩点击/Esc 关闭。
- 同文件 [L602-L609](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/mail/MailPanel.tsx#L602-L609)：工具栏「写邮件」按钮从填入命令改为打开弹窗。

## 验证

- `pnpm --filter @aiwb/web build` 通过。
- 无账户时按钮禁用；有多个账户时下拉可切换，弹窗底部实时显示对应 SMTP 地址；发送后自动切到 sent 并选中该邮件，摘要/红点同步刷新。
- 发送成功：弹窗底部切换为绿色成功条「✓ 已通过 SMTP 发送 · 主题」（草稿为「✓ 草稿已保存 · 主题」），1.5s 后自动关闭；顶部 notice 同时保留。

## 遗留

- 草稿不可在弹窗中再次编辑（草稿列表的「发送草稿」沿用原有 patch 逻辑）；`openCompose` 已预留 `prefill` 参数，后续接一个「编辑草稿」按钮即可回填。
- 附件、抄送、多收件人未支持。
