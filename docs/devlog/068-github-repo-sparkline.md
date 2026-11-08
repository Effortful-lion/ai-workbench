# 068 · GitHub 观察窗收尾：仓库卡片近 30 天提交 sparkline

日期：2026-11-07
状态：已完成（设计稿全量对齐）

## 背景

M1–M4 交付后逐行比对设计稿，发现唯一实质遗漏：§7 Tab 2 要求每张仓库卡片带「近 30 天 commit sparkline」，此前卡片只有语言/star/pushed 行。

## 决策

- **数据源 `stats/commit_activity`**：一次请求拿 52 周 × 7 天的提交数，比逐仓库拉 commits 再聚合省得多。保留 `days` 每日粒度（而非只存周 total），前端切近 30 天。
- **202 容错**：GitHub 首次统计该接口返回 202（后台计算中），此时快照空数组 + 短 TTL 10 分钟，避免每次打开卡片都触发重算；正常数据 TTL 24h（冷数据）。
- **每卡片懒加载**：RepoCard 挂载时各自调 `/activity`，失败静默不显示 sparkline；快照命中后整页卡片零 GitHub 请求。个人仓库数量级（几十）下首个周期 N 请求在 5000/h 预算内可忽略。
- **手写 SVG 柱状**：遵守设计「不引图表库」约束；30 根柱，`--acc` 透明度按值 0.3–0.9 渐变，零值 0.15 灰显；尾部 `N/30d` 总数，hover title 同样信息。

## 实现

- 后端 [github.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.service.ts) `commitActivity`：kind=commits、key=`owner/name::activity52`，404 抛 NotFound，其余非 200 抛错走全局过滤器。
- 路由 [github.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.controller.ts)：`GET /github/repos/:owner/:name/activity`。
- 前端 [GithubPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/github/GithubPanel.tsx)：RepoCard 加 `useEffect` 拉取 + `Sparkline` 组件（150×18 viewBox，preserveAspectRatio=none 自适应卡宽）。

## 验证

- 后端 build 通过，`/activity` 路由注册，无 token 正确 404。
- 前端 tsc：github 文件零错误。
- 真实效果需 PAT：打开仓库 Tab，每张卡底部应出现 30 柱 sparkline + 提交总数。

## 设计稿对齐状态

至此 §7 四个 Tab、§5 检索链路、§10 里程碑 M1–M4 全部实现。设计稿无剩余功能项；trending 等均为路线图外设想，设计文档本身未提及。
