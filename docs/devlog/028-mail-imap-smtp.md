# 028 · 邮件管理：邮箱注入 + 真实 IMAP/SMTP

- 日期：2026-11-03
- 状态：已完成（真实收发与双向同步均已联调）

## 目标

邮件管理不再是「假数据展示」，而是先由用户手动注入邮箱账户（邮箱地址 + 授权码/应用专用密码 + IMAP/SMTP 参数），系统才有权限读取该邮箱的邮件：

1. 多邮箱聚合：QQ / 163 / 126 / Gmail / Outlook / 自定义，统一收件箱。
2. 真实 IMAP 同步收件，真实 SMTP 发信 / 回复。
3. 账户可试连、可测活、可删除；密码加密存储且不回传。

## 决策

- **IMAP + SMTP 双通道**：收件走 `imapflow`，发件走 `nodemailer`，RFC822 解析用 `mailparser` 的 `simpleParser`（只取文本/HTML 降级，不落附件）。
- **密码用授权码**：国内邮箱普遍要求「授权码 / 应用专用密码」，UI 明确标注，不提示用户填登录密码。
- **密码加密落库**：复用 `common/crypto.ts` 的 AES-GCM，DTO 只暴露 `hasPassword`，任何接口都不返回明文。
- **服务商预设但可改**：预设只负责填 host/port/SSL 默认值，用户可覆盖，便于自建/企业邮箱。
- **幂等同步**：`externalId = imap:<accountId>:<uid>` 去重，单账户单次最多拉最新 50 封（`SYNC_LIMIT`），避免首同步噎死。
- **发送成功才落库**：`compose(draft=false)` / `reply` / 草稿转已发送，都必须先过 SMTP，失败抛 400 且不写库。
- **错误要可读**：IMAP/SMTP 原始错误常是 `Command failed`，改为优先取服务端 `responseText`，并按认证 / DNS / 拒连 / 超时补中文提示。
- **移除全部演示数据**：删掉 `DEMO_FIXTURES` 与库里的 `demo-%` 邮件、演示账户，避免再次误导。
- 被否决：把账户配置放 `.env`（多邮箱聚合场景下不可维护，也无法按用户隔离）。

## 实现

- `packages/shared/src/mail.ts`：新增 `MAIL_PROVIDER_PRESETS`（6 家）、`MAIL_ACCOUNT_STATUSES`、`MailAccountTestResult`；`MailAccountDto` 增加 `imapHost/imapPort/imapSecure/smtpHost/smtpPort/smtpSecure/hasPassword/status/lastError/lastSyncedAt`；`MailAccountInput.password` 语义为授权码；`MailSyncResult` 增加 `failed/details`。
- `apps/server/src/db/schema.ts`：`mail_accounts` 增加 `password_enc`、`imap_host/port/secure`、`smtp_host/port/secure`、`status`、`last_error`、`last_synced_at`；`provider` 默认值由 `local` 改为 `custom`。
- `apps/server/src/mail/mail.service.ts`：
  - `createAccount` / `updateAccount` 校验地址、补齐预设、`encrypt` 密码、配置变更后状态回到 `untested`。
  - `testConfig`（保存前试连，不落库）/ `testAccount`（已存账户试连并回写 `status`、`lastError`）。
  - `sync` 逐账户 IMAP `mailboxOpen("INBOX")` → `fetch("start:*")` → `simpleParser` → 按 uid 幂等插入；失败账户记 `error` 并在 `details` 返回原因。
  - `sendMail` 统一 SMTP 发送；`compose` / `reply` / 草稿转已发送均走真实发送。
  - `describeMailError` 统一把 IMAP/SMTP 错误翻译成可读文案。
- `apps/server/src/mail/mail.controller.ts`：新增 `POST accounts/test`、`PATCH accounts/:id`、`POST accounts/:id/test`，均 `mail:write` 权限。
- `apps/server/src/mail/mail.tools.ts`：`mail.sync` / `mail.compose` / `mail.reply` 描述改为真实 IMAP/SMTP 语义。
- `apps/web/src/features/mail/MailPanel.tsx`：标题栏新增「邮箱账户」按钮 → 注入弹窗（服务商预设自动填充、地址、授权码、IMAP/SMTP 主机端口 SSL、测试连接、保存邮箱）；账户列表带状态灯与测试/删除；同步提示带失败来源；写信/回复提示改为「已通过 SMTP 发送」；空收件箱文案引导先注入邮箱。

## 验证

- 构建：`pnpm --filter @aiwb/shared build`、`pnpm --filter @aiwb/server build`、`pnpm --filter @aiwb/web build` 全通过。
- 迁移：`sqlite3 ALTER TABLE mail_accounts ADD COLUMN ...` 共 10 列；清理 `demo-%` 邮件与演示账户。
- 接口（admin/admin，:8700）：
  - `GET /api/mail/accounts` → `[]`；`POST /api/mail/sync` → 400「请先添加邮箱账户（邮箱地址 + 授权密码）再同步」。
  - `POST /api/mail/accounts/test`（假 QQ 授权码）→ `ok:false`，`imap` 返回「认证失败：请填写授权码…」+ QQ 服务端原文。
  - `POST /api/mail/accounts` → `hasPassword:true`、预设 host 自动补齐；库内 `password_enc` 为密文（58 字节），无明文。
  - `POST /api/mail/accounts/:id/test` → 状态灯写回 `status:error` + `lastError`。
  - `POST /api/mail/sync` → `failed:1`，`details` 含账户与服务端原因。
  - `POST /api/mail/messages`（`draft:true`）→ 落 `drafts`；`draft:false` → 400「SMTP 发送失败：认证失败…」，未落库。
  - 验证后已删除测试账户与草稿（账户 0、邮件 0）。
- 页面：浏览器实测「邮箱账户」弹窗字段完整、QQ → 163 预设自动填充 `imap.163.com` / `smtp.163.com`、✕ 可关闭。
- 真实 QQ 邮箱端到端（`1106764332@qq.com`，别名 `server-lion@qq.com` 同一邮箱）：
  - 试连 → `ok:true`，`imap: 登录成功 · INBOX 169 封`，`smtp: SMTP 验证通过`，`latencyMs 1700`。
  - 首同步 → `created:50`、`failed:0`；再次同步 → `created:1 / skipped:49`，UID 幂等生效。
  - 库内 50 封解析正常（发件人、主题、已读标志、规则分类：重要 1 / 订阅 3 / 普通 46）。
  - `POST /api/mail/messages` 真实发送「[AI 工作台] SMTP 联调测试」至 `server-lion@qq.com` → 成功落 `sent`；20s 后回同步该邮件已进 INBOX，SMTP 送达闭环通过。

## 追加：双向同步（已读 / 移动 / 删除回写原邮箱）

- 背景：此前本地标记已读、移入 trash、删除只改本地库，QQ 客户端看不到变化，两端分叉。
- 决策：**先回写原邮箱，成功才改本地**；回写失败直接 400 且本地不变，宁可操作失败也不制造分叉。
  - 已读 → `STORE \Seen`（`messageFlagsAdd` / `messageFlagsRemove`，按 UID）。
  - 移动 → `MOVE`，仅开放 `inbox ↔ trash`；MOVE 后目标邮箱 UID 会变，用 `uidMap` 回填 `externalId`，否则后续操作会指向错误邮件。
  - 删除 → 收件箱内删除 = 远端移入 `\Trash`；回收站内删除 = `messageDelete`（`\Deleted + EXPUNGE`）。
  - 反方向：`sync` 对已同步过的 inbox 邮件回拉 `\Seen`，保证「在 QQ 客户端读了」本地也变已读。
  - 文件夹路径不硬编码中文（QQ 的 `\Trash` 实际是 `Deleted Messages`），统一按 `LIST` 的 `specialUse` 解析，找不到直接报错。
- 实现：`apps/server/src/mail/mail.service.ts` 新增 `cfgOf / remoteUid / remoteFolder / withImap / pushSeen / pushMove / pushDelete`，改造 `updateMessage`、`removeMessage`、`sync`（`local` Map 按 inbox 过滤，避免 trash 邮箱的 UID 与 INBOX UID 串号）。
- 验证（真实 QQ 邮箱，用自发的 `[SiftOps]` 测试邮件做道具，避免动用户真实邮件）：
  - 本地标未读/已读 → 远端 `INBOX uid=1828 \Seen=false / true` 来回切换成功。
  - `PATCH folder=trash` → 远端 `Deleted Messages` 出现该邮件，`externalId` 由 `:1829` 变为 trash 的 `:2`；`PATCH folder=inbox` 还原 → 回到 INBOX 且 UID 变 `:1864`，原 INBOX `:1829` 已不存在。
  - 远端把 `:1864` 标未读后再 `POST /mail/sync` → 本地 `isRead` 回拉为 `false`。
  - `DELETE`（收件箱）→ 远端进垃圾箱（`Deleted Messages` 出现该主题，INBOX UID 消失）。
  - `DELETE`（垃圾箱）→ 远端该 UID 彻底消失（垃圾箱与 INBOX 均查不到）。
  - 失败场景：临时改错授权码后 `PATCH isRead` → 400「同步到原邮箱失败：认证失败…」，本地 `isRead` 保持不变；恢复授权码后试连 `ok:true`，同一操作 200 且远端 `\Seen=true`。
  - 构建：`@aiwb/server` / `@aiwb/web` 通过。

## 遗留

- 同步只拉 INBOX 最新 50 封，未做增量水位（`lastSyncedAt` 仅记录时间）与已发送文件夹回写。
- 附件未入库，正文为纯文本；HTML 邮件走 `stripHtml` 降级。
- 删除只对 `inbox / trash` 回写远端；`sent / drafts` 的本地删除仍只删本地行。
- 收件箱删除后本地行直接移除，远端邮件留在回收站，要到 QQ 客户端才能看到（本地 trash 不镜像远端回收站）。
