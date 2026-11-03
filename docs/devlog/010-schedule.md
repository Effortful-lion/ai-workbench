# 010 · schedule 日程管理

- 日期：2026-11-02
- 状态：✅ 完成（接口 curl 权限矩阵全 PASS；浏览器验证 owner 排任务/完成任务、member 只读 PASS）

## 目标

按需求准备「日程管理 —— 任务-时间-通知提醒管理」落地二期第三个模块：

- 对应原型 `~/cal`：周视图时间线（08:00–21:00）+ 绝对定位任务块 + 当前时间线。
- owner 可排任务、标记完成/取消、删除；member 只读；guest 不可见。
- 任务 = 标题 + 开始时间 + 时长 + 优先级 + 地点 + 备注 + 提醒时间；提醒缺省开始前 10 分钟，可关闭。
- 终端式命令入口 `task.new <时间> <标题> [时长] [#high|#low] [@地点]`，替代表单。
- 注册 AI Tool（`schedule.list` / `schedule.upcoming` / `schedule.create` / `schedule.complete`）。
- 邮件与站内信按总体设计留作独立模块，不在本模块内合并实现。

## 决策

1. **只存开始时间 + 时长，结束时间派生**：`starts_at + duration_min` 计算 `endsAt`，避免两个时间字段互相矛盾；改时长即自动改结束。
2. **提醒时间落库为绝对时间**：`remind_at` 存毫秒时间戳，缺省 = 开始前 10 分钟；传 `null` 表示不提醒。相比存「提前 N 分钟」，绝对时间便于后续站内信/邮件扫描到点发送，也允许提前量各不相同。
3. **本期只做「到点提示」不做推送**：面板在提醒到点、任务一小时内开始、或已过期时展示提醒条；真正的推送通道（站内信、邮件）留到 011/012 模块，避免本模块耦合通知基础设施。
4. **周视图而非单日视图**：原型是竖向时间线，但「周视图」能同时回答「这周还有什么」，符合日程管理的核心诉求；每天一列、08:00–21:00、每小时 44px，超出窗口的任务只在清单里出现并标注时间。
5. **重叠任务简单分道**：同日重叠按贪心分配 lane，列内按 lane 宽度切分并保留 3px 间隙；不自动改期，只统计「N 项时间重叠」提醒用户，自动排冲突留作后期。
6. **状态三态**：`pending / done / canceled`；完成与取消都保留在时间线上（置灰删除线），便于回看，不做物理隐藏。
7. **权限复用角色体系**：新增 `schedule:read` / `schedule:write`；member 仅 `schedule:read`，guest 无，owner 由 `"*"` 覆盖。与原型 ACL `~/cal owner rw / member ro / guest ×` 一致。
8. **数据按 ownerId 隔离**：member 只读自己名下的日程，跨用户按 id 访问返回 404，延续个人工作台模型；协作共享日历延后。
9. **时间输入兼容多种写法**：服务端接受毫秒时间戳或 ISO 串并限制 2000–2100；命令栏支持 `10:00` / `今天 10:00` / `明天 09:30` / `2026-11-03 14:00`，降低日常录入成本。
10. **优先级兼容中文与 `#` 前缀**：服务端 `normalizePriority` 接受 `#high`、`高`、`低` 等写法，前端命令里用 `#high`/`#low` 标签；非法值返回 400。

## 实现

- 共享协议：[schedule.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/schedule.ts)
  （`TASK_PRIORITIES` / `TASK_STATUSES` / `ScheduleTaskDto` / `ScheduleTaskInput` /
  `ScheduleTaskPatchInput`），由
  [index.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/index.ts) 导出。
- 权限：[roles.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/roles.ts)
  member 新增 `schedule:read`。
- 服务端：
  - [schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts)
    新增 `schedule_tasks`（`id/owner_id/title/notes/location/starts_at/duration_min/remind_at/
    priority/status/created_at/updated_at`），已 `drizzle-kit push --force`。
  - [schedule.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/schedule/schedule.service.ts)
    `normalizePriority` / `normalizeStatus` / `normalizeStart` / `normalizeDuration`；
    `list` / `create` / `update` / `remove` / `upcoming` / `complete`（id 或标题精确匹配）；
    `toDto` 派生 `endsAt` 并把 `remindAt` 转毫秒或 null。
  - [schedule.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/schedule/schedule.controller.ts)
    `GET/POST /api/schedule/tasks`、`PATCH/DELETE /api/schedule/tasks/:id`、
    `GET /api/schedule/upcoming?days=7`。
  - [schedule.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/schedule/schedule.tools.ts)
    `schedule.list` / `schedule.upcoming`（`schedule:read`），
    `schedule.create` / `schedule.complete`（`schedule:write`）。
  - [schedule.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/schedule/schedule.module.ts)
    与 [app.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/app.module.ts) 接线。
- 前端：
  - [SchedulePanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/schedule/SchedulePanel.tsx)
    `startOfWeek` / `isoWeek` / `layoutDay`（贪心分道）、周切换与「今天」、7 列时间线、
    当前时间线、提醒条（到点/一小时内/过期）、任务清单（完成/删除）、`task.new` 命令解析、
    owner 可写 / member 只读。
  - [panel.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/panel.ts) 注册
    `cal`（`日程管理` / `~/cal`）；
    [PanelZone.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/PanelZone.tsx) 映射
    `cal: () => <SchedulePanel />`；
    [HeroState.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/HeroState.tsx) 新增
    「▸ 打开日程管理」chip；CommandPalette / CliOverlay 自动获得入口。

## 验证

- 构建：shared `tsc` 通过；server / web `tsc --noEmit` 0 错误；web `vite build` 通过（76 modules）。
- curl（owner / member 用 dev secret 手工签发 JWT，guest 用 role=guest 的测试 token）：
  - 未登录 `GET /schedule/tasks` → 401；guest → 403；member → 200；owner → 200。
  - member `POST /schedule/tasks` → 403；member `PATCH` / `DELETE` → 403。
  - owner 空标题 `POST` → 400「任务标题不能为空」；`priority=#最高` → 400「priority 仅支持 low / normal / high」。
  - owner `POST` ISO 时间串 → 201，`endsAt = startsAt + 90min`，缺省 `remindAt = startsAt - 10min`；
    `remindAt: null` 的任务返回 `null`。
  - `PATCH {"status":"完成"}` → 200 `status=done`（中文状态归一化生效）；
    `GET /schedule/tasks` 排序为 startsAt 升序；`GET /schedule/upcoming?days=7` 只返回 pending 且时间在窗口内。
  - `DELETE /schedule/tasks/:id` → `{"ok":true}`；member 列表始终为空（ownerId 隔离）。
  - `GET /tools`：owner 得到 4 个 schedule 工具；member 仅 `schedule.list` / `schedule.upcoming`。
- 浏览器（临时账号，验证后已删除并级联清理）：
  1. `cal-e2e`（owner）登录 → 首页 chip「▸ 打开日程管理」→ 周视图显示 `2026 · W45`、11-02–11-08；
     命令栏输入 `task.new 10:00 E2E评审 [30] #high @会议室A` → 时间线与清单出现该任务（pending）；
     点清单 `✓` → 状态 `done`，统计变为 `1 done`。
  2. `cal-view`（member）登录 → 面板显示 `read-only` 徽标与只读提示，无命令输入栏、无 `✗` 删除按钮，清单为空。
  3. 临时账号 cal-e2e / cal-view 已从 DB 删除。
- 演示数据保留在 lion 名下：今日「前端联调」（13:30，60 分钟）、「写周报」（明日 09:30，30 分钟）、
  「报销单提交」（10-30 已过期，用于展示提醒条）、「产品原型评审」（今日 10:00，已标记 done）。

## 遗留

- 没有真正的通知推送：提醒条仅在前端打开面板时可见，刷新页面不会弹通知，也没有浏览器 Notification API；
  站内信 / 邮件通道按总体设计留到 011 / 012。
- 不做重复日程（每周/每月）、全天任务、跨天任务、时区选择；时间线固定按本地时区展示，08:00–21:00 以外的任务只进清单。
- 重叠任务只做分道展示与计数，没有自动改期、冲突解决建议或拖拽调整时间。
- 不支持拖拽移动/拉伸改时长，也不支持点击空白格快速新建；时间修改只能走 API。
- 任务清单无关键词搜索、状态筛选、分页；数据量大时只显示最近一周时间线，清单最多滚动查看全部。
- 没有共享日历、参会人、接受/拒绝邀请、忙闲查询；`location` 只是文本，不解析会议链接。
- AI 工具可以查/建/完成任务，但不能改时间、取消任务或删除任务。
