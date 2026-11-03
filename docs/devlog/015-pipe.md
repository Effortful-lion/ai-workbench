# 015 · pipe 流水线工厂

- 日期：2026-11-02
- 状态：已完成

## 目标

对应 [需求准备.md](../需求准备.md) 第 31 行「流水线工厂 —— 主要负责各种领域的 sop 管理和实际生产操作」，落地三期第三个模块：

1. SOP 管理与可视化编排：一条 SOP = 有序步骤链（漫剧生成、小红书爆款文案、周报、短视频脚本）。
2. 实际生产操作：触发运行后按步骤顺序调用模型，记录每步输入/产出/耗时。
3. 运行记录：成功 / 失败 / 步骤进度 / 最终产出，失败可整条重试。
4. 概览：SOP 数、今日运行、成功率、平均耗时。
5. 视觉遵循 [prototype/index.html](../prototype/index.html) `pipe` 面板：SOP 卡片网格 + 最近运行行 + 终端命令栏，不做传统表单。
6. 权限遵循原型 ACL：`~/pipe owner rw / member × / guest ×`。

## 决策

1. **步骤用 JSON 落库，不拆步骤表**：步骤有序、数量少（≤12），编辑时整体重写；拆表会引入排序字段与级联维护，收益不匹配本期规模。运行明细另立 `pipe_run_steps`，因为需要逐条记录真实产出。
2. **同步顺序执行 + 失败短路**：一次运行在一个请求内按步骤串行调用模型；某步失败即中断，剩余步骤写 `skipped`，运行标记 `failed`。不引入任务队列，避免本期做重；长流水线的异步化留给后续。
3. **运行记录保留 SOP 名快照**：`pipe_runs.sop_name` 冗余存储，`sop_id` 在 SOP 删除时置空，历史运行仍可读。
4. **mock 模型产出显式标记**：`mock://` 无真实推理能力，直接返回 `[mock] 步骤「X」已完成 · 占位产出`，而不是把适配器的 `pong` 当业务结果。
5. **cron 仅展示**：`schedule` 是文案字段（如「每周五 16:00」），面板展示 `cron` 徽标；本期不接调度器，与 012 通知模块同样的取舍。
6. **权限 owner-only**：member / guest 未授予 `pipe:*`，HTTP `PermissionGuard` 与 Tool Registry 双重过滤；前端非 owner 直接渲染 403 说明。
7. **重试以整条运行为单位**：失败后重跑同一 SOP + 同一输入，生成新的运行记录；不做单步重试，避免上下文拼接语义复杂化。
8. **步骤指令可选**：步骤名必填、指令可空；空指令时提示词用「围绕本步骤名完成产出」兜底，命令栏可用 `名称：指令` 补充。
9. **前端常量内联**：Vite 对 shared CJS 的运行时常量解析不稳定，面板只从 shared 引入类型，时间/状态文案在组件内定义。

## 实现

- 共享协议：[packages/shared/src/pipe.ts](../../packages/shared/src/pipe.ts)，由 [index.ts](../../packages/shared/src/index.ts) 导出；定义 SOP / 步骤 / 运行 / 概览 / seed 结果类型。
- 数据表：[schema.ts](../../apps/server/src/db/schema.ts) 新增 `pipe_sops`、`pipe_runs`、`pipe_run_steps`，已 `drizzle-kit push`。
- 服务：[pipe.service.ts](../../apps/server/src/pipe/pipe.service.ts)
  - `listSops` / `getSop` / `createSop` / `patchSop` / `removeSop`；
  - `runSop`：挑模型 → 建运行 → 逐步拼提示词（SOP 说明 + 本次输入 + 前序产出 + 当前步骤）→ 调 `LlmAdapter.chat` → 落步骤明细；
  - `listRuns` / `getRun` / `retryRun`；
  - `digest`（今日运行、成功率、平均耗时）与 `seed`（4 条 SOP + 4 条运行记录，幂等）。
- 接口：[pipe.controller.ts](../../apps/server/src/pipe/pipe.controller.ts)，`/api/pipe/*` 全部 `JwtAuthGuard + PermissionGuard`。
- AI 工具：[pipe.tools.ts](../../apps/server/src/pipe/pipe.tools.ts)，注册 `pipe.digest`、`pipe.sop.list`、`pipe.sop.create`、`pipe.run`、`pipe.run.list`、`pipe.seed`。
- 模块接入：[pipe.module.ts](../../apps/server/src/pipe/pipe.module.ts)（复用 `ModelsModule` 导出的 `LlmAdapter`），并注册进 [app.module.ts](../../apps/server/src/app.module.ts)。
- 前端面板：[PipePanel.tsx](../../apps/web/src/features/pipe/PipePanel.tsx)：标题 chips / 摘要条 / KPI 四格 / 命令栏 / SOP 卡片列表 / 最近运行列表 / 右侧步骤编排 + 运行明细 + 最终产出。
- 面板接线：[panel.ts](../../apps/web/src/stores/panel.ts) 新增 `pipe`，[PanelZone.tsx](../../apps/web/src/shell/PanelZone.tsx) 映射组件，[HeroState.tsx](../../apps/web/src/shell/HeroState.tsx) 新增首页 chip。
- 命令：`pipe.seed` · `pipe.run <SOP> | <输入>` · `pipe.new <名称> | <步1 > 步2> | <周期>`。

## 验证

- 构建与类型：`pnpm --filter @aiwb/shared build`、server / web `tsc --noEmit` 均通过；`pnpm --filter @aiwb/web build` 81 modules。
- 数据库：`drizzle-kit push --force` 成功，`pipe_sops` / `pipe_runs` / `pipe_run_steps` 三表就位。
- 权限矩阵：owner `GET /api/pipe/digest` 200、`POST /api/pipe/seed` 201；member / guest 均为 403。
- 幂等：首次 seed 写入 4 条 SOP + 4 条运行，第二次 `{seeded:false}`。
- 运行：`POST /api/pipe/sops/:id/run` 对「小红书爆款文案」4/4 步完成；失败记录 `POST /api/pipe/runs/:id/retry` 重跑「漫剧生成」6/6 步完成。
- 编排：`POST /sops` 创建「播客脚本」、`PATCH` 暂停后运行返回 400、恢复后 `DELETE` 成功。
- 浏览器 E2E（headless Chrome + CDP，owner / member / guest）：
  - owner 打开面板可见 `4 sops`、摘要 `SOP = 可视化编排 + 批量调用 Agent`、四张 SOP 卡片、KPI；
  - 命令 `pipe.run 短视频脚本 | E2E 主题` 提示 `✓ 短视频脚本 完成 3/3`，右侧显示 `input: E2E 主题`；
  - 命令 `pipe.new E2E SOP | 抓取 > 整理 | 每周一 09:00` 创建成功并在卡片列表出现；
  - 表单输入 `E2E 直跑` 点「▸ 运行」提示 `✓ E2E SOP 完成 2/2`；
  - member / guest 均显示 `403 · ~/pipe 仅 owner 可访问`。
- 清理后最终状态：4 条 SOP、4 条运行记录（今日 2 次）、成功率 100%、均耗时 2m25s。

## 遗留

1. **cron 未接调度**：`schedule` 只是展示文案，没有常驻调度器；真正定时触发需与 012 通知/任务体系一起设计。
2. **运行同步阻塞**：请求等待全部步骤完成，长 SOP 易超时（单步 60s 上限）；后续应改任务队列 + 流式进度。
3. **无中断能力**：运行中不能取消；`status=running` 若进程崩溃会残留，需要启动时收敛或看门狗。
4. **只重试整条**：失败步骤不单独重跑，前序产出全部重算，成本偏高。
5. **上下文只带最后一步**：提示词仅拼接上一步产出（截断 3000 字），跨步多轮上下文会丢失。
6. **模型粒度单一**：一条 SOP 一个模型，不能逐步指定不同模型（如图像步走视觉模型）。
7. **mock 产出为占位**：演示环境只有 mock 模型可用，真实产出需接入真实模型。
8. **运行列表未按 SOP 过滤**：面板展示全局最近 12 条；后续可加筛选。
9. **seed 耗时是演示值**：预置运行记录的耗时来自 fixture，不是真实测量。
