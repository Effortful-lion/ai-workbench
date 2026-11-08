# 060 · 流水线可视化：异步执行 + 激光指向实时进度

- 日期：2026-11-07
- 状态：已完成

## 目标

让流水线工厂（~/pipe）的运行过程**实时可见**：任务执行到哪一步、哪一步出错，一眼可辨。对标 Coze 的「试运行面板」体验，但不引入节点画布（SOP 是线性顺序执行，DAG 是过度设计）。

验收标准：

1. 运行中能实时看到当前执行到哪一步（此前 `runSop` 是阻塞 HTTP，步骤只在完成后落库，运行期间前端拿不到中间态）；
2. 横向流水线视图：激光指向当前执行步，执行成功的保持高亮，未执行的灰色，执行出错的指向红色；
3. 失败即中断、后续步骤标 skipped，状态着色正确。

## 决策

- **异步执行而非流式（SSE/WS）**：`runSop` 拆为两段——同步创建 run 记录立即返回 runId，后台 `executeRun` 逐步执行。前端用 1.5s 轮询 `getRun` 拿进度。比 WebSocket 简单得多，对「每步数秒」的流水线场景足够实时，且复用现有 REST 接口，零新增通道。
- **步骤状态机扩展**：`PIPE_STEP_STATUSES` 加 `pending` / `running`。每步开始先写 `running` 记录，完成/失败后原地更新（同一行 id），失败中断时后续步骤插 `skipped`。run 级 `stepDone` 每完成一步同步，run 进度也实时可见。
- **激光指向定位规则**：优先指向 `failed` 步（红色），其次 `running` 步（警示色脉冲），全部完成则指向最后一步（高亮收官）。
- **横向节点链而非 DAG 画布**：线性 SOP 用「节点 + 连接线」横向排列即可，不引 ReactFlow 等重依赖。节点圆形带序号/对勾/叉，上方激光光束（竖线 + 菱形箭头）指向活动节点。
- **着色语义**：done = acc 高亮 + 发光、failed = err 红、running = warn 脉冲、pending/skipped = 灰。连接线已通过的段高亮、指向失败的段红、未到达的灰。

## 实现

### 后端

- [pipe.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/pipe.ts)：`PIPE_STEP_STATUSES` 加 `pending` / `running`。
- [schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts)：`pipe_run_steps.status` 枚举同步扩展。
- [pipe.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/pipe/pipe.service.ts)：
  - `runSop`：创建 run 记录、置 SOP `running` 后立即 `getRun` 返回；`void this.executeRun(...)` 后台执行，`.catch` 兜底把崩溃的 run 标 failed、SOP 复位 idle；
  - `executeRun`：每步开始插 `running` 记录，成功后 `update` 为 `done` 并同步 `run.stepDone`，失败 `update` 为 `failed` 并中断（后续插 `skipped`）；全部结束更新 run 状态/产出/耗时、SOP 复位。

### 前端

- [PipePanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/pipe/PipePanel.tsx)：
  - 新增 `PipelineTrack` 组件：横向节点链，激光指向活动节点（failed 优先 → running → 末节点），节点/连接线按状态着色，running 节点与激光带 `animate-pulse`；
  - 运行中轮询：`selectedRun.status === "running"` 时每 1.5s `getRun` 原地更新该 run，结束后 `loadAll` 全量刷新（同步左侧 runs 列表与 SOP 统计）；
  - 运行明细顶部加「● 执行中」脉冲指示，流水线视图插在输入摘要与纵向步骤明细之间。

## 验证

- 服务端 `npx tsc --noEmit` 通过、`nest build` 通过；web `PipePanel.tsx` 无类型错误（其余文件存在与本改动无关的既有类型错误）。
- 异步执行：创建 run 立即返回 runId，后台逐步执行。
- 真实模型（deepseek-flash）4 步 SOP 轮询实测：`[0:running]` → `[0:done, 1:running]` → … → 全部 done，`stepDone` 实时推进（0→1→2→3）。
- 浏览器端到端（browser_use）：
  - **运行中**：前 3 节点绿色对勾高亮，当前运行节点（润色）带激光指针 + 脉冲动画，未完成节点灰色；
  - **失败**（欠费 doubao 触发 403）：第一步红色节点 + 红色激光指针 + ✗，第二步灰色 skipped，run 标 failed。
- 三种状态（成功高亮 / 未执行灰 / 出错红指向）均按需求渲染。

## 步骤级断点重试

- 决策：**新建 run 而非原地改**——前 `fromStep` 步标 `skipped`（复用上次产出），从 `fromStep` 开始真正执行；前序产出拼接（取上次各 done 步 output，按序连接，截断至 3000 字）作为 `prior` 注入，保证上下文连续。`stepDone` 初始化为 `fromStep`，进度从断点开始。
- 后端：
  - [pipe.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/pipe/pipe.service.ts)：`executeRun` 加 `fromStep` / `priorOutput` 参数（前 fromStep 步直接 skipped）；新增 `retryRunFromStep(userId, runId, fromStep)`——取上次 run 前 fromStep 步的 done 产出拼 prior，产出不足时报错提示从更早步骤重试；`fromStep=0` 退化为整 run 重跑。
  - [pipe.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/pipe/pipe.controller.ts)：新增 `POST /pipe/runs/:id/retry-from`，body `{ fromStep }`。
- 前端：[PipePanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/pipe/PipePanel.tsx)：步骤行在 run 已结束且该步 `index >= stepDone`（失败步及之后）时显示「↻ 从此步重跑」按钮，调用 retry-from 接口并选中新 run。
- 验证：3 步 SOP 初次全 done；从 index 1 重试后，第 0 步 `skipped`（复用）、第 1/2 步 `done`（真正执行），新 run `stepDone=2`，所有步骤 input 含 `前序步骤产出`（prior 注入正确）。

## 表单化步骤编辑器

- 决策：**列表表单而非节点画布**——线性 SOP 的步骤编排用「每步一行（上下移箭头 + 序号 + 名称 + 指令 + 增删按钮）」即可，参考 WorkflowEditor 的阶段配置思路但不引 ReactFlow。模型选择在表单底部统一下拉（SOP 级，执行器目前单模型），步骤级模型留待执行器支持后再加。
- 前端：[PipePanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/pipe/PipePanel.tsx)：
  - SOP 步骤区改「查看 / 编辑」双模式，头部「✎ 编辑」进入表单，「✓ 保存 / × 取消」提交或放弃；
  - 编辑态支持改名称、改指令、`+` 在该步后插入、`−` 删除（至少保留 1 步）、`▲▼` 上下移；
  - 模型下拉只列 `kind=chat && status=ok` 的可用模型（加载 `/models` 过滤），`auto` 表示按 status=ok 优先挑选；
  - 保存走既有 `PATCH /pipe/sops/:id`（`steps` + `modelId`），空名称前置校验。
- 验证（browser_use）：编辑表单全部控件渲染正常；改步骤名、加指令、`+` 插入新步、`▲▼` 重排、选模型、`✓ 保存` 全流程通过；保存后只读模式正确显示更新后的步骤与指令（`// 指令`），控制台无报错。

## 新建 SOP 弹窗（流水线组装台）

- 决策：**节点链搭建器而非平铺表单**——新建弹窗沿用 mail.compose 的弹窗骨架（`fixed inset-0` 遮罩 + 终端风标题栏 `▸ pipe.new // 注释` + ✕ 关闭），但核心交互是横向节点链：圆形节点 + 箭头连接，尾端 `⊕` 追加，点选节点（选中态 acc 发光）后在下方编辑区改名称/指令、左右移、移除。与运行时的 PipelineTrack 视觉语言一致——「搭建时的链」和「运行时的链」是同一个隐喻。
- 前端：[PipePanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/pipe/PipePanel.tsx)：左栏 `~/pipe/sops` 头部加「+ 新建」；弹窗含 name/model、desc/cron 两行属性，节点链搭建器，选中节点编辑区，创建走既有 `POST /pipe/sops`；未命名节点用虚线边框提示，创建前统一校验。
- 验证（browser_use）：打开弹窗 → `⊕` 追加到 3 节点 → 逐个点选命名（选题/大纲/初稿）+ 填指令 → 创建成功，列表出现新 SOP、只读区正确展示 3 步，控制台无报错。

## 遗留

- **步骤级模型**：数据结构与执行器目前都是 SOP 级单模型；如需「选题用贵模型、初稿用便宜模型」需给 `PipeStepInput` 加 `modelId` 并让 `executeRun` 逐步挑选，属下一阶段；
- 轮询间隔 1.5s 写死，运行频繁时可考虑指数退避或后续升级 WebSocket；
- 大量并发运行时后台执行器无队列/并发限制，当前单用户场景可接受。
