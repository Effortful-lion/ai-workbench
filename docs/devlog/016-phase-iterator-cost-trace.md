# 016 · Phase 迭代器 + Cost 换算 + Trace 事件

- 日期：2026-04-20
- 状态：✅ 完成（后端 Schema + Gateway + TraceService 三轮构建 + 浏览器端到端全 PASS + DB 验证）

## 目标

从 Lancer 开源项目逆向「阶段式 Agent 执行 + 成本感知 + 完整执行轨迹」三个核心特性，落地到 AI-WORKBENCH：
1. Agent 支持多 Phase 链式执行，每个 Phase 可独立选择模型、工具子集、system prompt
2. 真实 token usage × 模型 pricing 换算成本，累加到 agent_executions.cost_yuan
3. 完整 Trace 事件流（phase.started / phase.done / tool 调用）落库 events_json，前端 TracePanel 实时渲染

验收标准：PhaseTestAgent 两阶段「调研→总结」完整执行，6 个 trace 事件无丢失，cost_yuan 公式验证正确。

## 决策

1. **Phase 迭代用 for-loop 而非递归**：Gateway 内 `for (const phase of agent.phases)` 顺序执行，每个 phase 独立调用 `pickModel()` + 构造 phase专属 system prompt `【当前阶段：name】目标：goal`。递归会增加栈深度和错误处理复杂度。
2. **成本单位用「分」（integer）存 DB**：避免浮点精度问题，展示时 `/100` 换算。DB schema `cost_yuan integer NOT NULL DEFAULT 0`。
3. **priceIn/priceOut 单位用「分 / 1k tokens」**：`ModelDto` 里 `priceIn: number` 表示每 1000 input token 多少分，与 Lancer 原始设计一致。公式 `cost = (prompt_tokens × priceIn + completion_tokens × priceOut) / 1000`。
4. **TraceService 串行 Promise 队列**：`emitTrace` 是 fire-and-forget 模式，但 `append()` 内部是 read-push-update 三步。并发调用会产生 race condition（后到的 append 读到旧 events 数组然后覆盖先到的结果）。用 `let appendQueue = Promise.resolve()` + `appendQueue = appendQueue.then(() => trace.append(...))` 保证串行。
5. **phase.modelId 为可选字段**：默认 `undefined` 表示使用通用默认模型，`string | null` 表示选特定模型。前端下拉三态：`◐ 默认` / `◑ provider/model ✗` / `◑ provider/model ?`。

## 实现

### Schema & Shared 类型
- `packages/shared/src/agents.ts`：新增 `AgentBudget` 接口 + `DEFAULT_AGENT_BUDGET` 常量 + `AgentPhase` 接口（含 `modelId?: string | null` + `tools?: string[]`）。
- `packages/shared/src/models.ts`：`ModelDto` 新增 `priceIn: number` / `priceOut: number` 字段。
- `apps/server/src/db/schema.ts`：`models` 表手动 ALTER TABLE 加 `price_in integer NOT NULL DEFAULT 0` / `price_out integer NOT NULL DEFAULT 0`；`agent_executions` 加 `cost_yuan integer NOT NULL DEFAULT 0`。

### 后端核心
- `apps/server/src/chat/chat.gateway.ts`：Phase for-loop 迭代器；每次 LLM 调用后从 `usageRef.usage` 取真实 token 数换算 cost 累加到 `snapshot.costYuan`；emitTrace 串行队列。
- `apps/server/src/chat/trace.service.ts`：新增 `start/append/finish` 三方法，events_json 整表 JSON 存储。
- `apps/server/src/chat/chat.service.ts`：`pickModel()` 返回完整 ModelDto（含 priceIn/priceOut）。
- `apps/server/src/agents/agents.controller.ts`：`POST /api/agents/executions` / `GET /api/agents/executions` / `GET /api/agents/executions/:id`。

### 前端
- `apps/web/src/features/models/ModelsPanel.tsx`：卡片显示 `¥(priceIn/100).toFixed(4)/¥(priceOut/100).toFixed(4) per 1k in/out`（warn 色）；创建表单加 priceIn/priceOut number input。
- `apps/web/src/features/agents/AgentsPanel.tsx`：编辑器每个 phase 加独立模型 `<select>`，从 `/api/models` 拉取并显示状态灯。
- `apps/web/src/features/chat/TracePanel.tsx`：树状迹线渲染 phase 事件 + cost + duration。
- `apps/web/src/shell/ChatColumn.tsx`：侧栏头部加 Agent 下拉（◐ 通用助手 / ◑ PhaseTestAgent / ◑ 测试Agent）。
- `vite.config.ts`：`@aiwb/shared` alias 直接指向 `packages/shared/src/index.ts`，绕过预构建缓存旧 CJS dist。

## 验证

### 浏览器端到端（macOS · Chrome · Vite dev 8701 + Nest 8700）

| # | 场景 | 结果 | 证据 |
|---|------|------|------|
| T1 | 登录 → 主界面 | ✅ | Hero 区 `下午好 admin` + 14 个面板入口按钮 |
| T2 | `/models` → ModelsPanel | ✅ | mock 模型 `¥0.0200/¥0.1000`，gpt-4o-test `¥0.0300/¥0.1500` |
| T3 | `/agents` → PhaseTestAgent 编辑 | ✅ | 两阶段 `调研→总结`，每阶段独立模型下拉含 6 选项 + 状态灯 |
| T4 | Chat 选 PhaseTestAgent 发送 | ✅ | TracePanel 6 事件完整：`agent.started → phase.started×2 → phase.done×2 → agent.done` |
| T5 | Console 健康度 | ✅ | 零 error/warn（仅 React DevTools info） |

### DB 验证

```sql
-- models 表 pricing 正确
SELECT provider, model_name, price_in, price_out FROM models;
-- mock|mock-1|2|10
-- openai|gpt-4o-test|3|15

-- 最新 agent_execution cost + trace 完整
SELECT status, tokens_used, cost_yuan, substr(events_json,1,600)
FROM agent_executions ORDER BY created_at DESC LIMIT 1;
-- status=done tokens_used=226 cost_yuan=2
-- events_json 含 6 个事件：agent.started/phase.started/phase.done ×2/agent.done

-- 公式验证：cost_yuan = Σ(phase) (prompt×priceIn + completion×priceOut)/1000 取整
-- Phase 1: (1×2 + 112×10)/1000 = 1.122 分
-- Phase 2: 同上 ≈ 1.122 分
-- 总计 ≈ 2.24 → 取整 = 2 分 ✅
```

## 修复记录

1. **Vite shared 包 ESM 报错 `DEFAULT_AGENT_BUDGET` not export**：根因是 Vite 预构建缓存旧 CJS dist（`packages/shared/tsconfig.json nodenext 输出 CJS`），新增导出在 CJS dist 里不存在。修复：`vite.config.ts` 加 alias `"@aiwb/shared": resolve(__dirname, "../../packages/shared/src/index.ts")` 直接指源码，`rm -rf node_modules/.vite` 清缓存。
2. **`emitTrace` 后 phase 事件落库丢失**：根因是 fire-and-forget `append().catch(()=>{})` 产生并发 read-push-update race。修复：串行 Promise 队列 `let appendQueue = Promise.resolve()` + `appendQueue = appendQueue.then(() => trace.append(...))`。
3. **后端 shell `&` 启动 1 分钟被杀**：根因是外部杀进程策略。修复：`run_in_background: true` 模式启动，不用 shell `&`。

## 遗留

### Phase 3 候选（非阻塞）
- **执行历史前端面板**：`/api/agents/executions` 端点已就绪，缺 `/history` 命令 + Agent 面板 tab。
- **`phase.requireConfirm` 暂停机制**：phase 间需人工确认，WS 侧等待 + 超时处理。
- **Phase 自动升级模型链**：调研用便宜模型、总结/实现用贵模型，省成本。
- **TracePanel 实时 cost 可视化**：`¥0.02 / ¥5.00` 进度条。
- **Token 过期优雅处理**：401 弹 toast + 编辑态 draft 保存。
- **Agent 编辑器 tools 分组折叠**：50+ checkbox 平铺信息过载。

### 真实模型验证
- deepseek-chat 配正确 apiKey 后完整跑 PhaseTestAgent，验证 function calling + 真实 usage 统计 + cost 换算。
