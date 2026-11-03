# 018 · 访问统计模块 + 预算进度条

- 日期：2026-11-02
- 状态：✅ 完成（后端 StatsModule + 前端采集 + StatsPanel 全通 + 手动 curl 验证）

## 目标

1. 让 Agent 运行时能实时看到预算消耗（TracePanel 已有 BudgetBar，修 payload 字段）
2. 网站访问统计（PV/UV/会话时长/热门页面），做成独立 `stats` 面板

## 决策

### 预算进度条
- BudgetBar 后端 `agent.done` trace 事件的 payload 是 `{ tokens, cost }`，前端之前读的是 `tokensEst`（不存在），修 payload 字段名匹配。
- `budget.hit` 事件 payload 有 `reason`（tokens/cost/timeout/depth/concurrency），前端显示 `⚠ budget hit (reason)`。

### 访问统计口径（经验库 2363679 · 必须先冻结口径）
- **PV** = 每次前端 panel 切换 / mode 变化算 1 次 page_view（不按 HTTP 请求，按用户行为）
- **UV** = localStorage 生成的 `sessionId` 去重（跨日同一浏览器仍同一 session，关闭浏览器不重置直到清理 localStorage）
- **停留时长** = 页面 A 离开时的毫秒差值（前端在 `visibilitychange: hidden` / `beforeunload` / panel 切换时上报）
- **热门页面** = GROUP BY path ORDER BY COUNT(*) DESC LIMIT 10
- **新访客 24h** = 当前 24h sessionId 集合 − 历史已有集合
- **活跃 1h** = 过去 1h 有访问的 distinct sessionId

### 前端采集架构
- `useVisitorCollector()` hook 挂在 App.tsx 里（登录后启用）
- 监听 `panelStore.subscribe()` 变化 → 触发 enterPage（记录上一页停留 + 进入新页）
- `visibilitychange: hidden` / `beforeunload` → `flush()`（批量上报，keepalive: true）
- 30s 心跳 flush（防意外退出丢数据）
- batch 未 flush 写 localStorage 兜底

### 后端 stats API
- `POST /api/stats/collect` — 无鉴权（匿名访客也能上报），batch 写入 visits 表
- `GET /api/stats/overview?days=7` — 需登录，聚合 PV/UV/trend/topPages/active/newVisitors
- SQLite `date(createdAt, 'unixepoch')` 聚合：createdAt 存 unix epoch **秒**（和 users/conversations 一致，不用 /1000）

### 终端 ASCII bar chart
- `asciiBar(value, max, width=20)` — ■ 满块 □ 空格，终端风格

## 实现

### DB
- `visits` 表（schema.ts）：id / sessionId / userId / path / refUrl / ua / durationMs / createdAt
- 手动 SQL 建表 + 索引（PRAGMA table_info + CREATE INDEX）

### 后端 StatsModule
- `stats.service.ts` — `bulkInsert()` 批量写入 + `overview(days)` 聚合（PV/UV/停留/今日vs昨日/7日trend/热门/活跃/新访客）
- `stats.controller.ts` — `POST /api/stats/collect`（无鉴权）+ `GET /api/stats/overview`（需 JwtAuthGuard）
- `stats.module.ts` — 注册到 AppModule

### 前端
- `lib/collector.ts` — `useVisitorCollector()` hook + `asciiBar()` 工具
- `features/stats/StatsPanel.tsx` — 顶部大数字卡 + 热门页面 Top10 bar chart + 7 日趋势 bar chart + 口径说明
- `stores/panel.ts` — PANEL_IDS 加 `stats`
- `App.tsx` — 引入 useVisitorCollector

### 预算进度条修复
- `features/chat/TracePanel.tsx` — BudgetBar payload 字段 `tokens` / `cost` / `budget.hit.reason` 正确读取

## 验证

### 后端
```bash
# collect 4 条不同 session/path 数据
curl POST /api/stats/collect → {"ok":true,"inserted":4} ✅

# overview 聚合正确
curl GET /api/stats/overview?days=7
{
  "pv": 4, "uv": 3, "totalDurationMs": 28000, "avgDurationMs": 7000,
  "todayPv": 4, "yesterdayPv": 4,
  "trend": [{"date":"2026-11-02","pv":4,"uv":3}],  # ← 日期正确（不是 1970）
  "topPages": [{"path":"/","pv":2},{"path":"/models","pv":1},{"path":"/stats","pv":1}],
  "activeSessions1h": 3, "newVisitors24h": 3
}
```

### 前端
- `pnpm --filter @aiwb/web build` exit 0
- Hero 区 `▸ 打开访问统计` 按钮可见
- `/stats` slash 命令已注册（PANEL_IDS 自动生成）

### Bug 修复
- SQLite timestamp 单位：其他表 createdAt 存 unix epoch **秒**（不是毫秒）。`date(createdAt, 'unixepoch')` 直接用秒数。之前错误 `/1000` 导致返回 1970 年日期。

## 遗留

- **StatsController.collect 无 rate limit** — 恶意用户可以刷 sessionId 膨胀 PV。生产环境加 IP throttle。
- **createdAt 混用**：StatsService 里 `new Date(cutoff)` 传给 Drizzle 会被 auto-convert，但 `countAfter()` 里 `gt(visits.createdAt, new Date(start))` start 是毫秒时间戳 → Drizzle 会调 `.getTime()` → 还是毫秒。其他表（users）是 drizzle `$defaultFn: () => new Date()` 存进 SQLite integer 列。查出来的是整数秒还是毫秒？实际上 `date(createdAt, 'unixepoch')` 工作了说明确实存的秒。这个要跨表统一口径。
- **前端 collector 模块循环依赖**：`collector.ts` 里 `getCurrentPath()` 用 `require("../stores/chat")` 有条件引入避免顶层 import。
- **活跃 session 计算**：`newVisitors24h` 的「24h 前出现过」查询逻辑用了 SQL IN (`?` 占位) — sessionId 多了会很慢。
- **StatsPanel 还没接刷新**：进面板时拉一次，不自动刷新。
