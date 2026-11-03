# 012 · notify 站内信

- 日期：2026-11-02
- 状态：✅ 完成（接口权限矩阵 / 扫描幂等 / 浏览器三角色验证全部 PASS）

## 目标

按总体设计二期顺序落地最后一个业务模块「站内信」，把 010 日程管理遗留的「提醒推送」和 011 邮件管理的「重要邮件提醒」收进统一的通知中心：

- `~/notify` 终端式通知面板：摘要、类型过滤、列表 + 详情阅读窗。
- 三类通知：`system` 系统消息、`schedule` 日程提醒、`mail` 重要邮件。
- 扫描日程到点提醒与收件箱未读重要邮件，按幂等键去重。
- owner / member 可用，guest 不可见；数据按用户隔离。
- 注册 AI Tool：查看、扫描、发送系统站内信、标记已读。
- 本期不做 Socket.io `/notify` 实时推送，作为遗留项记录。

## 决策

1. **站内信 = 统一通知落点**：010 的提醒条只在面板可见，011 的重要邮件也只能在邮件面板看到；012 把它们转成站内信，首页 / 通知中心成为真正的「待处理入口」。
2. **`dedupeKey` 保证扫描幂等**：日程用 `schedule:<taskId>:<remindAt>`，邮件用 `mail:<messageId>`。重复扫描只增加 `skipped`，不会刷重复消息；同一日程改提醒时间会生成新键，属于预期的新提醒。
3. **扫描只手动触发**：面板按钮、`notify.scan` 命令、REST / AI Tool 都调用同一个 `scan()`；不引入后台 cron 或常驻调度器，避免本期把通知基础设施做重。真正的定时推送与实时通道留到后续。
4. **日程扫描窗口为「提醒已到 + 开始时间在最近 24h」**：只提醒待办（`pending`），不扫已完成 / 已取消；超过 24h 的历史任务不再补发，避免首次扫描把旧任务全部刷成站内信。
5. **邮件扫描只取「收件箱 + 未读 + important」**：与 011 的 AI 分类口径一致；已读 / 订阅 / 垃圾邮件不进入站内信，减少噪音。
6. **权限与原型 ACL 对齐**：`notify:read` / `notify:write` 授予 member，guest 不授予，owner 由 `"*"` 覆盖；面板 ACL 为 `owner rw / member rw / guest ×`。
7. **数据按 userId 隔离**：所有查询与变更都带 `eq(userId)`，跨用户按 id 访问返回 404，延续个人工作台模型。
8. **读操作不写数据**：打开面板不会自动扫描；只有显式点击「扫描提醒」或执行命令才生成通知，避免「看一眼就产生数据」。
9. **详情可跳转业务面板**：`sourceId` 保存日程任务 / 邮件 id，详情页提供「→ 打开日程」「→ 打开邮件」，保持「通知只是入口」的定位。
10. **自建系统站内信**：`notify.send <标题> | <正文>`（以及 AI Tool `notify.send`）允许用户给自己留提醒，补齐 system 类型的使用场景。

## 实现

- 共享协议：[notify.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/notify.ts)
  （`NOTIFICATION_TYPES` / `NotificationDto` / `NotificationInput` / `NotificationDigestDto` /
  `NotificationScanResult`），由 [index.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/index.ts) 导出。
- 权限：[roles.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/roles.ts) member 新增
  `notify:read` / `notify:write`。
- 表结构：[schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts)
  新增 `notifications`（`id/user_id/type/title/body/is_read/source_id/dedupe_key/created_at`），
  用户级联删除；已 `drizzle-kit push --force`。
- 服务端：
  - [notify.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/notify/notify.service.ts)
    `list` / `digest` / `create` / `scan` / `markRead` / `markAllRead` / `remove` / `findByKey`；
    `scan()` 聚合日程提醒与重要邮件，按 `dedupeKey` 幂等。
  - [notify.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/notify/notify.controller.ts)
    `GET /api/notify/digest`、`GET/POST /api/notify/notifications`、
    `PATCH/DELETE /api/notify/notifications/:id`、`POST /api/notify/scan`、`POST /api/notify/read-all`。
  - [notify.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/notify/notify.tools.ts)
    `notify.list` / `notify.scan` / `notify.send` / `notify.read`。
  - [notify.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/notify/notify.module.ts)
    接入 [app.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/app.module.ts)。
- 前端：
  - [NotifyPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/notify/NotifyPanel.tsx)
    摘要条 / 类型与未读过滤 / grep / 终端列表 / 详情阅读窗 / 单条已读切换 / 删除 /
    全部已读 / 扫描提醒 / `notify.send`、`notify.scan`、`notify.read all` 命令栏 /
    日程与邮件详情跳转。
  - [panel.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/panel.ts) 注册
    `notify`（`站内信` / `~/notify`）；
    [PanelZone.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/PanelZone.tsx) 映射
    `notify: () => <NotifyPanel />`；
    [HeroState.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/HeroState.tsx) 新增
    「▸ 打开站内信」chip。CommandPalette / CliOverlay 由 `PANEL_META` 自动派生入口。

## 验证

- 构建：shared `tsc` 通过；server / web `tsc --noEmit` 0 错误；web `vite build` 通过（78 modules）。
- curl（owner / member 手工签发 JWT，guest 用 role=guest token）：
  - 未登录 `GET /notify/digest` → 401；guest → 403；member → 200；owner → 200。
  - guest `POST /notify/scan` → 403；member → 200（返回 0 条，符合「无自己数据」）。
  - owner 首次 `POST /notify/scan` → `{created:6, skipped:0, schedule:1, mail:5}`；
    再次扫描 → `{created:0, skipped:6}`，证明 `dedupeKey` 幂等。
  - owner `POST /notify/notifications` 创建系统通知 → 201；`PATCH {isRead}` → 200；
    `POST /notify/read-all` → `{updated:7}`；`DELETE` → `{"ok":true}`。
  - member `PATCH` owner 的通知 id → 404，用户隔离生效。
  - `GET /tools`：guest 无 notify 工具；member / owner 均得到
    `notify.list` / `notify.scan` / `notify.send` / `notify.read`。
- 浏览器（headless Chrome + CDP，注入 `localStorage['aiwb-auth']`）：
  1. owner 打开「▸ 打开站内信」→ `~/notify/inbox — N unread`、摘要条、类型计数、
     日程与邮件通知均出现在列表；点击未读系统通知 → 详情显示正文且头部变为 `0 unread`（自动已读）；
     「扫描提醒」→ 提示「扫描完成」；命令栏 `notify.send E2E 命令 | 来自浏览器命令栏` → 新通知出现。
  2. member 打开面板 → 正常进入 `~/notify/inbox`，无 403，空态提示「还没有站内信」。
  3. guest 打开面板 → `403 · ~/notify 仅登录用户可访问`。
  4. 截图检查：标题栏 / 摘要 / 过滤 chips / 命令栏 / 双栏列表 + 详情布局符合终端风格。
- 测试产生的 E2E 站内信已通过 API 清理；扫描生成的演示通知保留在 lion 名下。

## 遗留

1. **没有实时推送**：总体设计中的 Socket.io `/notify` namespace 未实现；新通知需要刷新面板或手动扫描才能看到，也没有浏览器 Notification API / 桌面通知。
2. **没有后台定时扫描**：不会在提醒到点时自动生成站内信；依赖用户打开面板点击「扫描提醒」或 AI/命令触发。
3. **通知渠道单一**：只做站内信；011 邮件模块没有按通知触发发邮件，也没有短信 / webhook 等外部通道。
4. **没有优先级、置顶、分组、批量已读之外的批量操作**；列表一次性返回全部，数据量大时需要分页。
5. **扫描窗口固定**：日程 24h、邮件只看未读重要邮件；不支持用户自定义提前量 / 静默时段 / 免打扰规则。
6. **没有消息模板与去重合并**：同一日程多次改期会产生多条通知，不做「相同任务合并成一条」。
7. **没有已读时间 / 点击埋点 / 通知设置页**：`notifications` 只记录 `is_read`，无 `read_at`、渠道偏好、订阅开关。
