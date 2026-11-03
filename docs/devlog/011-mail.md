# 011 · mail 邮件管理

- 日期：2026-11-02
- 状态：✅ 完成（接口 curl 权限矩阵 PASS；headless Chrome 验证 owner 收件箱/阅读/回复、member 403 PASS）

## 目标

按需求准备「邮件管理 —— 聚合各个邮件来源的邮件 + AI 分析后提供智能分类 + 邮件回复（可选）」落地二期第四个模块：

- 对应原型 `~/mail/inbox — 12 unread`：多来源聚合收件箱、AI 分类摘要条、`时间 / 发件人 / 主题+AI 建议 / 分类标签` 的终端行布局。
- 邮箱来源管理：添加 / 删除多个账户，账户 chips 过滤；收件箱跨账户聚合。
- 文件夹：`inbox / sent / drafts / trash`；未读、星标、已读、移入垃圾箱、永久删除。
- AI 分类：`important / subscription / spam / normal`，每封邮件落库分类理由，摘要条统计「重要 N · 订阅 N · 垃圾 N」。
- 本地写信与回复：`mail.compose` / `mail.draft` / `mail.reply`，发送进 `sent`，回复自动加 `Re:` 并标记原邮件已读；不接真实 SMTP。
- 终端式命令入口，替代表单：`mail.sync` / `mail.classify` / `mail.compose <收件人> <主题> | <正文>` / `mail.reply | <正文>` / `mail.account.add <名称> <地址>`。
- 注册 AI Tool（`mail.list` / `mail.read` / `mail.accounts` / `mail.classify` / `mail.sync` / `mail.compose` / `mail.reply`）。

## 决策

1. **一期做本地邮箱聚合演示，不接真实 IMAP/SMTP**：需求核心是「聚合 + 分类 + 回复」，真实协议会引入凭据保管、连接池、增量同步、推送与限流；本期先把数据模型、界面与 AI 工具链跑通，协议接入留作遗留。
2. **来源与消息两级模型**：`mail_accounts` 存名称 / 地址 / provider，`mail_messages.account_id` 外键级联；删除来源即级联清理其邮件。面板按来源 chips 过滤，满足「聚合多个邮件来源」。
3. **演示同步幂等**：`mail_messages.external_id` 记录固定样本 id；`mail.sync` 首次自动创建「工作邮箱 / 个人邮箱」两个来源并导入 13 封样本，再次同步只跳过已有项，不重复灌数据。
4. **规则式「AI」分类，可解释可测试**：标题命中权重 2、正文/发件人权重 1，取最高分；平分时重要 > 垃圾 > 订阅，全部未命中归为普通。分类结果与理由（如「命中『到期 / 续费』，建议今天处理」）落库，`classified_at` 驱动摘要时间。真实 LLM 分类待模型接入后替换实现，不动表结构。
5. **普通与订阅不自动进垃圾箱**：分类只打标签与建议，不替用户删除；垃圾邮件由用户点击 `→ trash` 或 `✗` 处理，避免误杀。
6. **发送 / 回复全部本地落库**：`sent` 中的邮件标注「本地发送，未接入真实 SMTP」；回复按原邮件发件地址回信、主题补 `Re:`、原邮件自动已读。草稿可通过 `PATCH folder=sent` 直接发出。
7. **权限严格对齐原型 ACL**：`~/mail owner rw / member × / guest ×`。新增 `mail:read` / `mail:write`，member 与 guest 均不授予，owner 由 `"*"` 覆盖；AI 工具按同一权限过滤，member 的工具列表中没有 `mail.*`。
8. **软删除优先**：列表操作「移入 trash」保留可恢复路径；只有 trash 中才暴露「永久删除」，避免误操作直接丢失邮件。
9. **终端式双栏布局**：左侧聚合列表，右侧阅读窗；写信/回复用单行命令栏与等宽文本块，不使用传统表单卡片；Account、分类、文件夹均以 chips / tab 呈现。
10. **数据按 ownerId 隔离**：沿用个人工作台模型，邮件只属于当前登录用户；跨用户按 id 访问返回 404。

## 实现

- 共享协议：[mail.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/mail.ts)
  （`MAIL_FOLDERS` / `MAIL_CATEGORIES` / `MailAccountDto` / `MailMessageDto` /
  `MailDigestDto` / `MailSyncResult` / `MailClassifyResult` 等），由
  [index.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/index.ts) 导出。
- 服务端：
  - [schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts)
    新增 `mail_accounts`、`mail_messages`（含 `external_id` / `is_read` / `is_starred` /
    `category` / `ai_reason` / `classified_at`），已 `drizzle-kit push --force`。
  - [mail.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/mail/mail.service.ts)
    `classifyContent` 规则分类；账户 CRUD；`listMessages` / `getMessage` / `updateMessage` /
    `removeMessage`；`compose` / `reply` / `classify` / `sync` / `digest` / `findByKey`；
    演示数据 `DEMO_FIXTURES` 13 封覆盖重要/订阅/垃圾/普通。
  - [mail.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/mail/mail.controller.ts)
    `GET/POST /api/mail/accounts`、`DELETE /api/mail/accounts/:id`、`GET /api/mail/digest`、
    `GET /api/mail/messages?folder=&category=&accountId=&unread=&q=`、
    `GET /api/mail/messages/:id`、`POST /api/mail/messages`、
    `POST /api/mail/messages/:id/reply`、`PATCH/DELETE /api/mail/messages/:id`、
    `POST /api/mail/classify`、`POST /api/mail/sync`。
  - [mail.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/mail/mail.tools.ts)
    7 个 AI 工具，读工具 `mail:read`、写工具 `mail:write`。
  - [mail.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/mail/mail.module.ts)
    与 [app.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/app.module.ts) 接线。
- 前端：
  - [MailPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/mail/MailPanel.tsx)
    来源 chips、文件夹 tab、分类/未读/关键词过滤、AI 分类摘要条、终端双栏列表 + 阅读窗、
    星标/已读/移入 trash/永久删除、草稿发送、回复输入、命令解析与账户增删；
    owner 可写，member 显示 `403 · ~/mail 仅 owner 可访问`。
  - [panel.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/panel.ts) 注册
    `mail`（`邮件管理` / `~/mail`）；
    [PanelZone.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/PanelZone.tsx) 映射
    `mail: () => <MailPanel />`；
    [HeroState.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/HeroState.tsx) 新增
    「▸ 打开邮件管理」chip；CommandPalette / CliOverlay 自动获得入口。

## 验证

- 构建：shared `tsc` 通过；server / web `tsc --noEmit` 0 错误；web `vite build` 通过（77 modules）。
- curl（owner / member / guest 用 dev secret 签发 JWT）：
  - 未登录 `GET /mail/accounts` → 401；guest → 403 `requires mail:read`；
    member → 403；owner → 200。
  - member / guest `POST /mail/sync` → 403 `requires mail:write`。
  - owner `POST /mail/sync` → `{created:13, skipped:0, accounts:2, classified:13}`；
    再次同步 `skipped:13`，幂等。
  - `GET /mail/digest` → `inbox 13 / unread 13 / accounts 2`，
    `categories {important 6, subscription 4, spam 2, normal 1}`，
    `summary「AI 分类完成 — 重要 6 · 订阅 4 · 垃圾 2 · 已为你标记」`。
  - `POST /mail/classify` → `{scanned:13, important:6, subscription:4, spam:2, normal:1}`。
  - 非法收件人 `POST /mail/messages` → 400「邮箱地址不合法」；重复来源 → 400「该邮箱地址已存在」。
  - 草稿 `POST /mail/messages {draft:true}` → `folder=drafts`；`PATCH folder=sent` → `folder=sent`，
    `aiReason「已从草稿发出（本地演示，未接入真实 SMTP）」`。
  - 回复首封收件箱邮件 → `sent` 新增 `Re: …`，`toAddress` = 原发件人，原邮件 `isRead` 变 true。
  - `DELETE /mail/messages/:id` → `{"ok":true}`；sent 恢复 0。
  - `GET /tools`：owner 返回 7 个 `mail.*`；member 返回空数组。
- 浏览器（headless Chrome + CDP，临时注入登录态，验证后关闭）：
  1. owner `lion` 首页 chip「▸ 打开邮件管理」→ 面板标题 `~/mail/inbox — 12 unread`、
     摘要条「AI 分类完成 — 重要 6 · 订阅 4 · 垃圾 2」、13 封邮件与 AI 理由均可见。
  2. 点击「域名 ai-workbench.cn 将于 7 天后到期」→ 阅读窗显示正文、AI 理由「命中『到期 / 续费』」
     与回复输入，列表该邮件自动标记已读。
  3. member `alice` 打开同一面板 → 居中显示 `403 · ~/mail 仅 owner 可访问`，无输入与操作入口。
- 演示数据保留在 lion 名下：2 个来源（工作邮箱 / 个人邮箱），13 封收件箱邮件，12 未读（1 封在回复验证后变为已读）。

## 遗留

- 未接真实 IMAP/SMTP：不能收发外部邮件、不校验凭据、没有连接池 / 增量同步 / 推送；
  `provider` 仅作展示标签。
- AI 分类是关键词规则而非模型推理：不支持语义改写、多语言同义词、个性化偏好与反馈学习；
  后续可替换为 LLM 分类并保留 `category / ai_reason` 字段。
- 无附件、无 HTML 正文渲染、无邮件线程（thread）聚合；回复只生成新邮件，不串联原邮件会话。
- 草稿创建后不能再次编辑正文；只能在阅读窗直接发送或删除。
- 列表无分页，服务端一次返回当前文件夹全部邮件；数据量大时需补游标分页与索引。
- 无转发、抄送/密送、回复全部、签名、模板、定时发送；`mail.reply` 只回复发件人。
- 无自动归档 / 自动清理规则；垃圾邮件需手动移入 trash，不做自动删除。
