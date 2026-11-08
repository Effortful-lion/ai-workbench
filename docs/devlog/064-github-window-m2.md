# 064 · GitHub 观察窗 M2（热力图 / 语言环 / 仓库详情）

日期：2026-11-07
状态：已完成（M2）

## 目标

实现设计稿 M2：贡献热力图、语言占比环、仓库详情（README + 文件树 + 提交时间轴）。让「概览 / 仓库 / 活跃」三个 Tab 有真实数据。

## 决策

- **贡献日历走 GraphQL**：REST 无贡献日历接口，GraphQL `user.contributionsCollection.contributionCalendar` 一次拿 53 周每日数据，且走独立 5000 points/h 额度不占 REST 预算。细粒度 PAT 需能读自身数据（`Contents: Read` 即可）。
- **语言占比聚合所有仓库**：逐仓库 `GET /repos/:full/languages` 累加字节，单仓库失败跳过不影响整体。TTL 24h（L3），结果存单条 `kind=languages` 快照。
- **90 天提交柱 + 月度对比从日历数据推导**：不额外发请求，复用 `contributionsCalendar` 的每日 contributionCount。诚实标注为「贡献」（含 commit/PR/issue/review），不假装是纯 commit。
- **文件树从 flat path 构建嵌套结构**：GitHub `git/trees?recursive=1` 返回 `["src/a.ts", "src/b/"]` 形式，前端 `buildTree` 递归建树；truncated 时给警告提示去 GitHub。
- **单文件 >256KB 拒绝**：与设计稿一致，提示去 GitHub 查看。内容用 `Accept: application/vnd.github.raw` 拿纯文本，TTL 5min。
- **仓库详情聚合 meta + README**：`repoDetail` 并行拉 `repo` 和 `readme` 两个快照，README 解码 base64；commits/tree 独立懒加载。

## 实现

后端（[github.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.service.ts)）：
- 新增 `calendar`（GraphQL POST，TTL 24h）、`languages`（聚合，TTL 24h）、`repo` / `readme` / `commits` / `tree`（REST，TTL 30–60min）、`file`（raw，>256KB 拒绝，TTL 5min）、`repoDetail`（repo+readme 聚合）。
- 抽出 `getSnapshot` / `putSnapshot` 私有工具，供 GraphQL 与聚合类快照复用（`fetchSnapshot` 专为 REST ETag 设计）。

路由（[github.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.controller.ts)）：
- `GET /github/activity/calendar`、`/activity/languages`
- `GET /github/repos/:owner/:name`（详情）、`/commits`、`/tree`、`/file?path=`

共享层（[operations.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/operations.ts)）：补 6 个 `github.activity.*` / `github.repo.*` 操作，全部 `github:read`、`risk: read`。

前端（[GithubPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/github/GithubPanel.tsx)）：
- Tab 结构：概览 / 仓库 / 活跃。
- **概览**：profile 卡（头像/名字/bio/统计）+ 贡献热力图（53×7 网格，GitHub level 五档映射 `--line` 与 `--acc` 16/30/48/68% 透明度，hover `title` 显示日期+数量，底部 mono 总数）。
- **仓库**：M1 卡片网格 → 点击进详情。详情含 meta 卡（topics chips / stars/forks/watchers/issues/license）+ 子 tab：README（复用 `MarkdownText`）/ 文件（左侧可折叠树 + 右侧文件正文，截断警告）/ 提交（15 条时间轴：`shortSha · message · author · relTime ↗`）。
- **活跃**：语言环（`conic-gradient`，GitHub 语言色板 + fallback，top 8 + 其它）+ 近 90 天贡献柱（SVG，`--acc` 透明度按值渐变）+ 本月/上月对比与环比。

## 验证

- 后端 `pnpm build` 通过；`calendar` / `languages` / `repo` 等 6 条路由全部注册。
- 未配置 token 时，所有 M2 接口返回 404「尚未配置 GitHub Token」，权限守卫正常。
- 前端 `tsc --noEmit`：github 相关文件零错误（仅 chat/ 下 2 个预存错误）。
- 浏览器：登录 → GitHub 观察窗 → PAT 设置表单渲染正常，控制台无 JS 运行时错误。
- 真实 GitHub 数据（热力图 / 语言环 / 仓库详情）需填入有效 PAT 后由用户验证（PAT 不在仓库内）。

## 遗留

- M3：Tab 1 右上 AI 今日简报 + 三个数字格（待 review / 指派 / 需关注 CI 失败）、Tab 4 收件（search issues review-requested + assigned + notifications）。
- CI 状态（workflow runs）随仓库详情 L2 一起取，用于「需关注」计数，M3 补。
- 贡献热力图的 contributionLevel 若 PAT 权限不足可能返回 NONE 全空，需用户确认 PAT 有读自身数据权限；若全空可加提示。
- 语言色板只硬编码了常见 ~22 种，其余走 fallback 调色板；可后续接 `github-linguist` 色表。
- 仓库详情的 commits/tree 未加手动刷新按钮，依赖 TTL；高频查看可加 refresh。
