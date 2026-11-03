# 024 · 站内信接收侧化 · 日程可视化 · 流水线去演示数据

- 日期：2026-11-02
- 状态：✅ 完成
- 前置：023 简历导入

## 目标

三个体验问题的收口：

1. 站内信由系统投递，用户只是接收方，不应出现任何「发送站内信」入口。
2. 站内信顶部占位过大，收敛为一个铃铛图标 + 红点未读数。
3. 日程管理缺少可视化操作，新增 / 编辑 / 完成 / 取消 / 删除都要能在界面上完成。
4. 流水线工厂移除预置演示数据，空态从零开始编排。

## 决策

| 问题 | 选择 | 原因 |
|------|------|------|
| 站内信发送能力 | 保留 `POST /notify/notifications`，删除前端入口与 `notify.send` AI 工具 | 系统侧仍要投递；对用户暴露发送入口会误导 |
| 未读提醒位置 | 顶栏一个铃铛 + 红点数字，面板内一行紧凑摘要 | 顶栏是全局入口，面板顶部不需要大字标题 |
| 未读刷新 | 60s 轮询 `/notify/digest` | 项目暂无全量推送通道，轮询成本可接受 |
| 日程表单 | 内联表单（`task.new` / `task.edit`）而非弹窗 | 与终端风格一致，少一层遮挡 |
| 时间格点击 | 30 分钟对齐后带入日期时间 | 比手选下拉更快，且用户明确要「可视化添加」 |
| 命令栏 | 保留 `task.new` 单行命令 | 终端用户习惯；与表单共用同一套 REST 接口 |
| 流水线演示数据 | 前后端 + 共享类型 + Makefile + DB 五处删除 | 只删 UI 会留下死接口和 AI 工具 |

## 实现

### 站内信（纯接收侧）

- `apps/web/src/features/notify/NotifyPanel.tsx`：删除命令栏与 `parseSend()`；新增 `BellIcon`；顶部压缩为「铃铛（含 `bg-err` 红点）+ N 未读 + 条数/今日 N + 全部已读/扫描提醒」一行；容器 `py-6 → py-4`。
- `apps/web/src/shell/TopBar.tsx`：新增全局铃铛按钮，60s 轮询未读数，`>99` 显示 `99+`，点击 `openPanel("notify")`。
- `apps/server/src/notify/notify.tools.ts`：移除 `notify.send`。
- `apps/server/src/notify/notify.service.ts`：digest 空态文案改为「暂无站内信 — 系统会在有提醒时自动投递」。

### 日程可视化

- `apps/web/src/features/schedule/SchedulePanel.tsx`
  - `Draft` + `draft` 状态承载新建/编辑；`saveDraft()` 校验标题、`YYYY-MM-DD`/`HH:MM`、时长 5–1440，默认 `remindAt = startsAt - 10min`，有 id 走 PATCH，否则 POST。
  - owner 头部新增「＋ 新建日程」；表单字段：标题、日期、开始时间、时长、优先级、地点、备注。
  - 周视图列空白处点击 → 按 `clientY` 换算 30 分钟对齐（裁剪到 08:00–20:30）→ 带入表单；任务卡片 `stopPropagation` 避免误触。
  - 时间线下新增选中详情条：`✎ 编辑` / `✓ 完成` / `↺ 恢复` / `⊘ 取消` / `✗ 删除`。
  - 任务清单每行操作常显（原删除仅 hover 可见）。

### 流水线去演示数据

- 前端 `PipePanel.tsx`：删除「演示数据」按钮、`runSeed()`、`pipe.seed` 分支。
- 后端 `pipe.service.ts` 删除 `seed()` 与 `daysAgoAt()`；`pipe.controller.ts` 删除 `POST /pipe/seed`；`pipe.tools.ts` 删除 `pipe.seed`；`packages/shared/src/pipe.ts` 删除 `PipeSeedResult`；`Makefile` 的 `seed-all` 去掉该调用。
- 数据：`data/workbench.db` 清空 `pipe_run_steps` / `pipe_runs` / `pipe_sops`（原 lion、admin 各 4 条 SOP + 12 runs + 53 steps）。

## 验证

| 项 | 方式 | 结果 |
|----|------|------|
| 站内信无发送入口 | 浏览器 | PASS：全页无「发站内信」，顶栏铃铛可打开 `~/notify` |
| 站内信顶部 | 浏览器 | PASS：单行「铃铛 + 0 未读 0 条 · 今日 0」 |
| 日程新建 | 浏览器 | PASS：`＋ 新建日程` → 表单 → 保存 → 时间线与清单出现 |
| 日程操作 | 浏览器 | PASS：详情条 `✎/✓/✗` 可用，`✓ 完成` 后状态变 done |
| 流水线空态 | 浏览器 | PASS：无「演示数据」按钮，SOP 0 条，空态文案正确 |
| 移除接口 | curl | `POST /api/pipe/seed` → 404；`/api/pipe/sops` → `[]` |
| 构建 | pnpm | shared / server / web 全部通过 |

验证用的临时日程已通过 `DELETE /api/schedule/tasks/:id` 清理，任务列表回到 `[]`。

## 遗留

- 站内信未读数是轮询而非推送；接入 WS 后可改为事件驱动。
- 日程暂无拖拽调整时长、跨天任务与重复日程。
- 流水线仅有 SOP 与运行记录的增删编，模板市场未做。
