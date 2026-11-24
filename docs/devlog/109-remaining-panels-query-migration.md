# 109 · 剩余面板继续迁移 React Query

日期：2026-11-11 ｜ 分支：main ｜ 类型：perf / refactor

## 一、范围

108 只接了 5 个常用面板，本轮把 `apps/web/src` 里其余「挂载即 `useEffect + api()`」的组件全部梳理并迁移。
统一模式：

- 同一面板的多个 GET 用 `Promise.all` 合并进**一个 query**（写操作整体失效，减少 key 数量）；
- 带参数的请求把参数放进 key：`QK.stats(days)`、`QK.ghRepos(q)`、`QK.mailMessages(folder)`、
  `QK.projectDocs(id)`、`QK.crmCustomer(id)`、`QK.latestTrace(conversationId)`；
- 原来的 `reload()/load()` 改为 `invalidate(...keys)`，乐观更新改为 `queryClient.setQueryData`；
- 保留 `setError` 名称给写操作，读错误用 `writeError ?? query.error?.message` 组合，JSX 不用改；
- `enabled` 严格对齐原有权限门：`canAccess`（commerce/crm/mail）、`isOwner`（公开页待审数）、
  `!!user`（模型列表）、`canManage`（GitHub 收件箱/简报）。

**QK 扩展**：tools、customTools、executions、latestTrace、stats、schedule、projects、projectDocs、
codeRepos、codeFiles、commerce、crm、crmCustomer、kb、kbTree、mailSummary、mailMessages、mailDigest、
ghAccount、ghProfile、ghRepos、ghOverview、ghInbox、ghActivity、contact。

## 二、迁移清单

| 文件 | 处理 |
|---|---|
| `HistoryPanel` `/agents/executions?limit=50` | useQuery；刷新按钮从整页 reload 改 `refetch()` |
| `StatsPanel` `/stats/overview?days=` | useQuery（key 带 days）；补加载中态，避免闪「加载失败」 |
| `SchedulePanel` `/schedule/tasks` | useQuery；状态/删除乐观改缓存 + invalidate |
| `TracePanel` `/agents/executions/latest` | useQuery（key 带会话 id） |
| `ToolsManagerPanel` `/tools` + `/tools/custom` | 两个 useQuery，写后一起失效 |
| `ProjectsPanel` `/projects` + `/projects/:id/docs` | 列表/文档双 query；自动选中第一个项目改由 effect 同步 |
| `CodePanel` `/code/repos` + `/code/repos/:id/files` | 同上 |
| `CommercePanel` digest/plans/orders/ads | 合并 query；`execute()` 保留 useCallback |
| `CrmPanel` digest/customers + 客户详情/跟进 | 合并 query + 按 id 的详情 query；`selectCustomer` 只改 id |
| `KbPanel` documents/kb-links/folders | 合并 query + 目录树 query；3s pending 轮询改 `refetch()`；发布状态 Map 由缓存同步 |
| `MailPanel` accounts/digest/messages | 摘要 + 文件夹列表双 query；`aiwb:mail-changed` 改由摘要变化广播；60s 轮询与自动同步保留；乐观读/删改缓存 |
| `GithubPanel` account/profile/repos + overview + inbox/activity tab | 顶层合并 query、Overview 四合一 query、InboxTab/ActivityTab 各自 query；手动强刷 `refresh=1` 结果写回缓存；Token 绑定后 refetch |
| `PublicBlogPage` 待审数 | 复用 `QK.blogModeration("pending")`；发评论后失效 |
| `TopBar / ContactBadge` `/profile/contact` | useQuery(QK.contact) |

## 三、保留原实现（有意为之）

- `TopBar` 的 `/notify/digest`、`/mail/digest` 60s 轮询 + `aiwb:*-changed` 事件：这是红点实时同步链路，
  事件已做到 ~20ms，改 query 反而会引入延迟；
- `PublicContactPage`、公开博客页的文章/评论列表：走裸 `fetch` 且有游客/owner 双分支与失败回退，
  属于公开页按需加载，不是面板重复挂载；
- `GithubPanel` 的仓库详情 / PAT 表单 / 单仓库活动：由用户点开弹窗触发，非面板挂载；
- `PublicResumePage` / `PublicToolboxPage`：公开只读页，无写操作。

## 四、验证（playwright-cli，dev 8701，admin）

循环「打开面板 → 关闭 → 30s 内重开」，统计 GET 请求：

| 面板 | 首次 | 重开 |
|---|---|---|
| stats / history / cal / projects / code / aitools | 1–3 / 1 / 1 / 2 / 2 / 2 | **0** |
| kb / crm / biz / gh / mail | 3 / 4 / 4 / 7 / 3 | **0** |

补充：

- `StatsPanel` 切 `days=7 → 30` 分别请求 `/stats/overview?days=7`、`?days=30`，动态 key 生效；
- GitHub 顶层 account/profile/repos、Overview 四接口与两个 tab 都命中缓存；
- 邮件面板的 60s 轮询、3 分钟节流自动同步、红点广播逻辑保留；
- 控制台无 React Query 报错；`pnpm --filter @aiwb/web exec tsc --noEmit` 通过。

## 五、遗留

- 生产包仍是单个约 922KB 的 JS，首屏体积可再做代码分割；
- GitHub 首次冷启动 0.9–1.2s 来自外部 API（服务端有 30min/15min/24h 快照 TTL），缓存只减少重复进入；
- 邮件服务端 60s 增量同步与面板 60s 轮询是两个独立节奏，未合并。
