# 078 · AI 简报改造 + 「如何联系我」公开页

日期：2026-11-08
状态：已完成

## 目标

- AI 简报从 1 条提升到 4–5 条，只保留有事件锚点的动态（发布 / 安全 / CI / star 增速 / 归档等），与本周热门榜按 `owner/repo` 互斥，简报内部同仓库只出现一次；失败兜底遵守同样规则。
- 「如何联系我」做成公开信息页，不进业务面板：顶栏入口与邮箱图标同规格，hover 出绝对定位预览卡，点击进 `/c/:username`，所有者可在页内编辑并设置渠道可见性。

## 决策

- GitHub 数据继续由 `GithubService` 取数，不引入流水线 SOP（流水线每步只调 LLM，无取数/工具步骤，`schedule` 无调度器，输出仅保留最后一步纯文本）。
- 简报候选由服务端确定性生成，LLM 只做筛选与措辞；因此 LLM 失败、少给条数或编造仓库都不会破坏条数与去重规则。
- 联系方式存 `users.profile_json.contact`，不新建表、不做迁移；公开读取在服务端按 `visibility` 过滤，避免微信/电话泄漏。
- star 增速需要历史基线，新增 `digest_stars` 快照（TTL 7 天）：首次运行只写基线，第二次起才有 STAR 事件。

## 实现

AI 简报（[github.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.service.ts)）：

- 快照类型新增 `digest_stars`
- `DigestItem` 增加 `repo` / `eventType` / `eventAt`；快照结构为 `{ items, source, excludedTrending }`
- `digest()` 流程：inbox → trending（构建互斥集合）→ repos → star 增速 → 确定性候选 → LLM 筛选 → 强校验 → 兜底补齐
- 新增 `buildDigestCandidates` / `buildStarEvents` / `candidateScore` / `notificationEventType` / `notificationText` / `normalizeDigestItems` / `ensureDigestCount`
- 删除旧的 `ruleDigest`（用热门榜填充会与热门榜自身重合）
- 前端 [GithubPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/github/GithubPanel.tsx)：简报改为全宽卡片 `DigestCard`，带事件徽章、repo、事件时间、外链与来源（LLM / 规则兜底）；热门榜底部标注与简报互斥

联系页：

- 类型 [contact.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/contact.ts)
- 操作目录 [operations.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/operations.ts) 新增 `PROFILE_OPERATIONS`（公开读取 / 本人读取 / 本人保存）
- 服务端 [contact.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/contact/contact.service.ts)：归一化渠道、`https/mailto` 链接白名单、无 contact 时用简历 `basics.email/website` 兜底、写入合并 `profile_json` 不覆盖简历
- 公开页 [PublicContactPage.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/contact/PublicContactPage.tsx)：`/c/:username` 只读；所有者登录后出现编辑入口，渠道带「公开 / 仅自己」徽章
- 路由：[App.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/App.tsx) 公开页分发；[route.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/lib/route.ts) 的 `isPublicPath` 加入 `c`，避免登录态被 hash 路由改写
- 顶栏 [TopBar.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/TopBar.tsx)：邮箱按钮后新增联系入口，同 `h-[26px] px-2 border border-line rounded` 规格；预览卡 `absolute right-0 top-full` 不撑高顶栏；`hover:none` 的触屏不做预览、点击直达；`Esc` 关闭，卡片可 Tab 聚焦、Enter 打开；邮箱支持一键复制
- 能力手册 [site.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/tools/site.tools.ts) 补 `profile` 模块描述
- 三个公开页统一返回控件 [PublicBackLink.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/public/PublicBackLink.tsx)：位置固定在顶行最右侧、`mb-4` 与页面 `px-4 py-8` 留白一致；同源 referrer 时 `history.back()`，外链/书签直接打开则回站内首页；简历 `/p`、百宝箱 `/t`、联系 `/c` 同步替换

## 验证

- `pnpm --filter @aiwb/shared build` 通过
- `pnpm --filter @aiwb/server build` 通过
- `apps/web` 下 `npx tsc --noEmit -p tsconfig.json` 零错误
- 起 `node apps/server/dist/main.js` 后冒烟：`GET /api/profile/public/admin` 返回 200，`contact` 由简历 `basics.email` 兜底生成，且仅含 `public` 渠道；验证后已停服
- 原型：[digest-contact.html](file:///Users/lion/workspace/gocode/ai-workbench/docs/prototype/digest-contact.html)

未做：`GET/PUT /api/profile/contact` 需要登录态，未改动真实账号数据。

## 修复：AI 简报空数据（2026-11-08 追加）

真实请求 `GET /api/github/inbox/digest?refresh=1`（admin 账号）返回：

```json
{"items":[],"source":"rule","excludedTrending":["kkkkhazix/agent-autoloop", "...4 个"],"stale":false}
```

根因不是热门榜互斥（候选在互斥前就是 0），而是：

1. 该账号的通知、待 review、指派、CI 失败、star 增速、归档仓库全为空 → `buildDigestCandidates` 产出 0 条。
2. 兜底 `candidates.slice(0, 5)` 同样为空，等于兜底没有兜住。
3. 空结果照样写进 `github_snapshots` 并按 30 分钟 TTL 缓存，刷新拿到的还是同一份空快照。
4. 前端空态文案存在，但页面没有内容，实际观感就是「空的」。

修复：
- `buildDigestCandidates` 增加兜底事件源 `buildPushCandidates`：近 30 天有 push 的仓库生成 `commit` 事件，锚点为 `pushed_at`，链接用仓库 `htmlUrl`，仍走同仓库去重与热门榜互斥。
- `digest()` 空结果 TTL 由 30 分钟降为 5 分钟；非空仍 30 分钟。
- 前端 `DigestCard` 增加「↻ 刷新」按钮，`onRefresh` 走 `?refresh=1`；空态文案改为说明原因与缓存策略。

修复后同一请求返回 2 条真实事件（该账号近 30 天只有 2 个仓库有 push，其余事件源仍为空）：

```json
{"items":[
 {"text":"近 4 天有新提交：Effortful-lion/ai-workbench","repo":"Effortful-lion/ai-workbench","eventType":"commit","eventAt":"2026-11-03T20:26:36Z"},
 {"text":"近 8 天有新提交：Effortful-lion/ai-workbench-lancer","repo":"Effortful-lion/ai-workbench-lancer","eventType":"commit","eventAt":"2026-10-31T08:20:55Z"}
],"source":"rule","excludedTrending":["kkkkhazix/agent-autoloop", "...4 个"],"stale":false}
```

说明：`source` 为 `rule` 是因为当前首个可用模型的调用返回 `403 AccountOverdueError`（账户欠费），属设计内回退；条数按真实候选数量返回，不为了凑 4–5 条编造事件。

## 遗留

- STAR 事件依赖 `digest_stars` 基线，首次部署当周不会出现该类型。
- 联系页渠道为空时公开页仅显示「尚未填写」；是否在顶栏隐藏入口未定。
- 旧 `profile_json` 里手写的未知联系字段会被归一化丢弃（与简历一致的边界策略）。
