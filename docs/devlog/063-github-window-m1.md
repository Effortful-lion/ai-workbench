# 063 · GitHub 观察窗 M1（只读快照 + PAT 设置 + 仓库列表）

日期：2026-11-07
状态：已完成（M1）

## 目标

实现设计稿「GitHub 观察窗」的 M1 闭环：让用户能用 fine-grained PAT 接入 GitHub，在工作台里只读浏览自己的仓库列表。所有数据走本地快照表，限流时返回 stale 旧数据，UI 诚实标注「同步于 HH:MM」。

验收：
- 后端：账号 CRUD + profile/repos 快照接口，PAT 加密存储，校验失败返回 error 状态而非 500。
- 前端：PAT 设置表单 → 顶栏（@user · N repos · 同步于 · 刷新 · ↗ github.com）→ 仓库卡片网格（2 列，深链回 GitHub）。
- 只读：不定义 `github:write`，PAT 只勾 read。

## 决策

- **专用 `github_snapshots` 表**（而非复用通用 kv 表）：kind+key 复合定位、payload JSON、etag、fetchedAt、expiresAt。owner 级联删除。理由：GitHub 数据种类多（profile/repos/repo/readme/commits/...），需要独立 TTL 与 ETag 条件请求，通用表语义不清。
- **快照层统一在 service**：`fetchSnapshot<T>(kind, key, path, ttlMs, parser)` 封装「命中未过期→返回；带 If-None-Match 请求；304 只刷新时间；403/429/5xx 返回旧快照标 stale；200 更新 payload+etag」。UI/AI 永远只读快照，不直接打 GitHub。
- **PAT 校验失败不回滚 token**：setToken 时立即拉 profile 校验，失败则置 `status=error` + `lastError`，保留加密 token（用户可在原表单重填）。理由：回滚会让用户以为没保存，且错误信息对排查有用。
- **仓库范围限定个人**：`/user/repos?per_page=100&sort=pushed`，不做 org/starred 搜索。q 为本地过滤（0 额外请求）。

## 实现

- [schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts#L574-L608)：`githubAccounts`（tokenEnc AES-GCM、status ok/error/untested、lastError）+ `githubSnapshots`（kind/key/payload/etag/fetchedAt/expiresAt），已 `pnpm db:push`。
- [github.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.service.ts)：`getAccount`（masked token）、`setToken`（encrypt + 立即校验 + 失败置 error）、`removeAccount`（级联清快照）、`fetchSnapshot` 通用、`profile`（TTL 30min，成功回填 username+status=ok）、`repos`（TTL 15min，本地 q 过滤）。
- [github.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.controller.ts)：`/github/account` GET/DELETE、`/github/account/token` POST、`/github/profile`、`/github/repos`，全部 `@RequirePerm("github:read")`。
- 共享层：[operations.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/operations.ts) 加 `GITHUB_OPERATIONS`（profile.get / repos.list，GET，risk=read）；[roles.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/roles.ts) member 加 `github:read`；[site.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/tools/site.tools.ts) MODULE_META 加 github。
- 前端：[GithubPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/github/GithubPanel.tsx)——PatSetup（fine-grained 只读提示 + 创建地址 ↗ + 错误回显 + 移除账号）+ 顶栏（@user 深链 / N repos / stale 琥珀色 · 同步于 / 过滤 / 刷新 / ↗ github.com）+ RepoCard 网格（私有/归档标记、language 圆点、★ ⑂、defaultBranch · relTime、hover ↗）。
- 注册：[PanelZone.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/PanelZone.tsx) 加 `gh`、[HeroState.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/HeroState.tsx) 加快捷入口、[commands.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/lib/commands.ts) PANEL_NAMES 加 `gh`、[panel.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/panel.ts) 加 `gh` id+meta。

## 验证

- `pnpm build`（server）通过；`pnpm db:push` 建表成功。
- REST：未配置时 `/account` 返回 null、`/profile` 返回 404「尚未配置 Token」；setToken 用假 token 返回 `status=error` + `lastError="GitHub 401: Bad credentials"`（不再 500）；DELETE 清除账号+快照。
- 前端 tsc：github 相关文件零错误（chat/ 下两个预存错误与本次无关）。
- 浏览器：admin 登录 → 首页「GitHub 观察窗」chip → 面板渲染 PAT 设置表单（标题、密码框、fine-grained 只读提示、保存按钮）；返回首页 chip 存在。

## 遗留

- M2：Tab 1 概览（贡献热力图 53×7 + AI 今日简报 + 三个数字格）、Tab 3 活跃（语言环 conic-gradient + 90 天提交柱 + 月度对比）、Tab 4 收件（待 review / 指派 / 通知）。需要补后端 snapshot kind：contributions、inbox、notifications、runs、languages。
- M2：仓库详情（README react-markdown + 文件树 + 15 条提交时间轴），需 repo/readme/commits 快照。
- 未做 OAuth / GitHub App，单 owner 只读 PAT 足够；多用户场景后置。
- 贡献热力图数据：GitHub 无 REST 直接给 contributions，需走 GraphQL（需 PAT 勾 `user:read` + GraphQL 权限）或爬取 svg，M2 定方案。
