# 065 · GitHub 观察窗 M3（收件 / AI 简报 / 数字格 / CI 状态）

日期：2026-11-07
状态：已完成（M3）

## 目标

实现设计稿 M3：收件（待 review PR / 指派 issue / 未读通知）、AI 今日简报、概览页三个数字格、仓库详情 CI 状态。M1+M3 构成「每天会被打开的那一屏」。

## 决策

- **CI 状态不单独拉**：GitHub 没有全局 workflow runs 接口，逐仓库查翻倍请求量。做法按设计稿——最新 run 随 L2 仓库详情一起取（`GET /repos/:full/actions/runs?per_page=1`），落 `kind=runs` 快照（TTL 30min）；概览「需关注」数从已缓存 runs 快照推导，零额外请求。PAT 无 Actions 权限或仓库未启用 Actions 时静默为 null。
- **inbox 聚合快照**：2 条 search（`is:pr is:open review-requested:@me` / `is:issue is:open assignee:@me`）+ `GET /notifications`，合并落一条 `kind=inbox` 快照（TTL 15min，L1）。三个源独立容错（Promise.all 各自 catch 置空），单源失败不拖垮整个收件。
- **notification 深链转换**：subject.url 是 API 地址，后端转成网页链接（`/pulls/N→/pull/N` 等），转不了回落仓库页。
- **AI 简报双轨**：优先用 `ModelsService.listRealModels()[0]` 走 `LlmAdapter.chat` 生成（严格 JSON 输出 + 宽容解析，URL 白名单校验 `https://github.com` 前缀）；LLM 不可用/解析失败时回退规则模板（CI 失败 > 待 review > 指派，按优先级取 3 条）。生成结果落 `kind=digest` 快照 30 分钟，不发 GitHub 请求。
- **简报生成的是判断不是动作**：每条一句话 + `↗` 深链回 GitHub，工作台不代办任何事。

## 实现

后端（[github.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.service.ts)）：
- `ciRun`：随 repoDetail 聚合，fetchSnapshot `kind=runs`，404/403 catch 为 null。
- `inbox`：聚合 search×2 + notifications + ciFailing 推导（查 runs 快照中 `conclusion==="failure"`）。
- `digest`：getSnapshot 命中即返回；否则取 inbox 数据 → 规则模板兜底 → 尝试 LLM 精化 → putSnapshot 30min。
- 模块级辅助：`InboxItem` 类型、`notifHtmlUrl`、`parseDigestJson`。
- 注入 `ModelsService` + `LlmAdapter`（[github.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.module.ts) 加 `ModelsModule`）。

路由（[github.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.controller.ts)）：`GET /github/inbox`、`GET /github/inbox/digest`，`?refresh=1` 强制刷新。repoDetail 响应新增 `ci` 字段。

共享层（[operations.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/operations.ts)）：补 `github.inbox.list` / `github.inbox.digest`。

前端（[GithubPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/github/GithubPanel.tsx)）：
- **Tab 1 概览**改为左热力图 + 右栏（300px）：右上 AI 简报（≤3 条，绿点 + 一句话 + ↗，空显示 `// 今天没有需要你处理的事`，底部标注生成时间/stale）；右下三个数字格（待 review / 指派给我 / 需关注，>0 分别绿色/琥珀，点击跳收件 Tab）。
- **Tab 4 收件**：ciFailing 琥珀警告条 + 三组列表（PR/issue 徽标、标题、repo#number、作者、相对时间、↗），按组倒序，全空显示 `// 收件箱是空的`。
- **仓库详情 meta 卡**：CI 状态点（success 绿 / failure 琥珀 / 其他灰），hover title 显示 workflow 名与结论，点击 ↗ 到 run 页。

## 验证

- 后端 `pnpm build` 通过；`/github/inbox`、`/github/inbox/digest` 路由注册成功。
- 无 token 时两个新接口返回 404「尚未配置 GitHub Token」，权限守卫正常。
- 前端 `tsc --noEmit`：github 相关文件零错误。
- 浏览器：登录 → 面板 → PAT 表单渲染正常，控制台无 JS 运行时错误。
- 真实数据（收件三组 / 简报 / CI 点）需有效 PAT 由用户验证。

## 遗留

- M3.5：`github.search.repos` + `search.multi` 跨源检索 + 结果行卡渲染。
- M4（可选）：`github.ask` 仓库问答、review 草稿生成、代码搜索。
- 简报固定用第一个真实模型，未做失败轮换（capability.service 有 ROUTE_FAIL_TTL 模式可借鉴）。
- ciFailing 只统计「打开过详情」的仓库（runs 快照只在详情打开时写入）；未打开的仓库不参与计数，UI 文案已诚实说明是「最近一次 CI」。
- notifications 深链转换覆盖 pulls/issues/commits/releases，Discussions 等少见类型回落仓库页。
