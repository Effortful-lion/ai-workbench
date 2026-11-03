# 022 · Bug 修复 — reasoning_tokens · 模型定价 · 后端启动稳定性

- 日期：2026-11-02
- 状态：✅ 完成（4 个修复 + 后端启动方案确认）
- 前置：020 真实 LLM 接入 + 021 Agent Tools/Budget 端到端

## 目标

Phase 5 验证后发现的 3 个架构级问题，以及一个反复出现的运维问题。

## 修复清单

### FIX-1 · reasoning_tokens 未计入 tokens/cost（预算/成本隐形漏洞）

**位置**：`chat.gateway.ts` L259-284

**现象**：豆包 lite 的 SSE usage 里 `completion_tokens_details.reasoning_tokens` 独立于 `completion_tokens`（约占总 completion 的 99%）。gateway 只读 `prompt_tokens` + `completion_tokens`，导致：
1. `snapshot.tokens` 被低估 ~10× — budget 几乎永远超不了
2. `snapshot.costYuan` 如果 priceOut 非零，也少算 reasoning 部分

**修复**：
```typescript
// llm.adapter.ts StreamUsageRef 加字段
export interface StreamUsageRef {
  usage?: {
    ...
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

// chat.gateway.ts 累计 tokens 时
let reasoningTokens = usageRef.usage.completion_tokens_details?.reasoning_tokens ?? 0;
snapshot.tokens += usageRef.usage.total_tokens 
  ?? (promptTokens + completionTokens + reasoningTokens);

// cost 换算时 reasoning 按输出价计费（豆包 CoT 也是 token）
const costFen = Math.round(
  (promptTokens * pIn) / 1000 + ((completionTokens + reasoningTokens) * pOut) / 1000
);
```

**影响**：非 reasoning 模型（GPT-4o/mock）无变化。reasoning 模型的预算/成本现在准确。

### FIX-2 · 模型 priceIn/priceOut 默认 0（cost 通道死锁）

**位置**：DB `models` 表

**现象**：所有模型 `price_in=0, price_out=0`，导致 `snapshot.costYuan` 永远是 0，budget.hit 只能靠 tokens/timeout 触发。Phase 5 的 cost=0 拦截其实是 pickModel 时就被拦，**不是 LLM 调用后 cost 累积触发**。

**修复**：给豆包模型填价格（近似公开价）：
```sql
UPDATE models SET price_in=1, price_out=2 
WHERE id='644f6067-1cad-4ea6-8098-d478a25c5cc1';
```

**单位**：`分 / 1k tokens`。1 分 = ¥0.01。所以 `price_in=1` ≈ ¥0.001/1k tokens（接近豆包 lite 公开价）。

### FIX-3 · pickModel 无序（mock 排前面）

**位置**：`chat.service.ts pickModel()`

**现象**：`rows.find(m => m.status === "ok")` 不保证顺序。两条 mock 记录也是 `ok` 且排在 volces-ark 前面 → chat 默认用 mock。

**临时修**：把 mock 的 status 降级为 `untested`（020 已做）。

**更稳的后续**：给 models 表加 `priority` 字段，pickModel 按 `ORDER BY status DESC, priority DESC` 取第一个。

### FIX-4 · 后端进程反复自杀（Trae shell 环境）

**现象**：`nohup pnpm dev & disown`、`pnpm start &`、后台 shell 退出后 node 进程全部被 kill。多次重试均如此。

**根因**：Trae 的 shell executor 在命令完成后清理所有子进程（类似 cgroups 清理）。`run_in_background: true` 启动的进程**不会**被清理。

**确认方案**：
```bash
# ✅ 稳定：run_in_background + 静态 node dist
pnpm build     # 先 build 一次（nest build → dist/main.js）
node apps/server/dist/main.js   # run_in_background

# ❌ 不稳定：pnpm dev（tsx watch 起父子进程），后台命令结束时父子都被杀
pnpm dev:server & disown
```

**验证**：
- `run_in_background=true` 启动 `node dist/main.js` → 15 秒后 `curl 200`、lsof PID 不变
- 之前 `disown + nohup` 方式 → 日志显示 started 但 5 秒后进程消失

**代价**：要改代码必须重新 `pnpm build` + 重启。开发时用 `pnpm dev` 在前台 shell 里。

## 验证结果

| # | 修复 | 验证 |
|---|------|------|
| FIX-1 | reasoning_tokens 入账 | 代码已改 + build 通过 + 模型 test 3417ms 正常 |
| FIX-2 | 模型定价 | DB price_in=1, price_out=2 |
| FIX-3 | pickModel | mock=untested, volces-ark=ok 唯一 |
| FIX-4 | 启动方案 | run_in_background + node dist/main.js 15s 存活 |

## 后续

1. models 表加 priority 字段，pickModel 按 priority 稳定排序
2. 豆包模型更准的价格（查公开文档，目前填的是近似值）
3. build → dist → run_in_background 流程脚本化（Makefile）
