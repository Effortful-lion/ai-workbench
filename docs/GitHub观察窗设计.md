# GitHub 观察窗 · 设计

> 版本：v0.1（讨论稿）  日期：2026-11-07
> 定位一句话：**不做一个 GitHub 客户端，做一扇只读的观察窗。**

---

## 1. 为什么不集成写操作

GitHub 本身在仓库页、PR 页、Actions 页上已经有成熟完整的编辑与操作体验。在工作台里再造一套"创建 PR / 建仓库 / 重跑 CI"，本质是用更差的 UI 复刻一遍成熟产品，同时把三类成本拉进来：

1. **实现成本**：写操作要处理分支保护、权限、冲突、幂等、错误回滚，一条都不是查接口能解决的。
2. **风险成本**：写权限的 token 一旦泄露，最坏是被用来推恶意代码、改仓库、删分支。
3. **认知成本**：两套操作入口，用户要判断"这次该在哪边点"，反而更慢。

反过来，只读化的收益是结构性的：

- **权限模型上直接没有写权限**——不是"约定不写"，是 `github:write` 这个权限点根本不存在，任何代码路径都写不了。这比靠代码审查保证纪律更硬。
- token 用 fine-grained + 只勾 read 类权限。泄露的最坏后果从"改坏仓库"降到"读到私有代码"，且随时可一键吊销。
- 交互收敛成一条原则：**看在这里，做在那里**。所有可操作对象带 `↗` 深链回 GitHub。

只读不等于没有智能。写操作交给 GitHub，**判断、摘要、提问留在工作台**——这才是 AI 该提供的那部分价值。

---

## 2. 边界

| 做（只读消费） | 不做（回 GitHub 操作） |
|---|---|
| 账号概览、仓库列表与详情 | 建 / 删 / fork 仓库 |
| 文件树、单文件内容、README 渲染 | 建分支、提交、push、改文件 |
| 最近提交时间轴 | 建 PR、merge、发 review comment、改 PR 状态 |
| 贡献热力图、语言分布、提交趋势 | 触发 / 取消 / 重跑 workflow |
| 待 review PR、指派给我的 issue、未读通知 | 改 issue 状态、assign、close、加 label |
| CI 状态灯（读 run 结论） | 下载 artifact、改 secrets |
| 仓库 / 代码 / issue 搜索（只读） | —（搜索本身不产生写操作） |
| AI 今日简报、仓库问答、review 草稿（本地生成） | 标通知已读（GitHub 的已读也是写操作） |

**明确不做 webhook。** 本地没有公网入口，为几个展示位引入 smee/ngrok 或云端转发不值得；轮询 + 手动刷新足够，代价只是"数据有几十分钟延迟"，这一点在 UI 上诚实标注即可。

**明确不做 OAuth 多用户。** 当前是 owner/member 单工作台模型，一个人的只读 PAT 就够；等真要给别人用再谈 GitHub App。

---

## 3. 数据层：快照优先

GitHub 是外部数据源，面板不能每次打开都打接口。所有数据先落本地快照，UI 只读快照。

```ts
// github_snapshots
id          text pk
owner_id    text  -> users.id (cascade)
kind        text  // profile | repos | repo | readme | commits | languages | contributions | inbox | notifications | runs
key         text  // 如 "Effortful-lion/ai-workbench"，聚合类为空串
payload     text  // 原始 JSON（压缩后存）
etag        text  // 条件请求用
fetched_at  integer
expires_at  integer
```

`GithubSyncService.get(kind, key, ttl)` 的取数逻辑：

1. 命中且未过期 → 直接返回快照；
2. 否则带 `If-None-Match: <etag>` 请求，**304 只更新 `fetched_at`**（304 不计入限流）；
3. 200 则覆盖 payload + etag；
4. 403/429（限流）→ 沿用旧快照，返回 `stale: true`，不抛错。

所有出网 DTO 统一带 `fetchedAt` 与 `stale`，前端状态栏显示「同步于 12:04」，绝不假装实时。

### 分级刷新（限流预算的核心）

不按「全量刷新」设计，按用户实际看什么懒加载：

| 级别 | 内容 | 频率 | 请求数 |
|---|---|---|---|
| L1 常驻 | 仓库列表 + 未读通知 + 收件搜索（2 条 search） | 15 分钟 | 4 |
| L2 按需 | 单仓库详情 + README + 最近提交 | 打开该仓库时，TTL 30 分钟 | 3 / 仓库 |
| L3 每日 | 语言字节分布（N 个仓库）+ 贡献日历（1 次 GraphQL） | 24 小时 | N + 1 |
| 手动 | 用户点刷新，强制绕过 TTL | — | 同 L1 |

算下来：L1 约 16 次/小时，看 5 个仓库再加 15 次。REST 认证额度 5000/小时，占用不到 1%。贡献日历走 GraphQL（独立 5000 points/小时额度），不占 REST 预算。

**CI 状态不单独拉。** GitHub 没有"全局 workflow runs"接口，逐仓库查会翻倍请求量。做法是：仓库卡片的 run 状态随 L2 详情一起取，概览页的「需要关注」从已缓存状态推导，零额外请求。

---

## 4. 接口与工具

对 GitHub **只发 GET**。工作台内部可以有 POST（如问答），但 `risk` 一律标 `read`——判据是"是否改动外部系统"，不是 HTTP 方法。

### 操作目录（`operations.ts`，一次定义三处可用）

| key | 路径 | 说明 |
|---|---|---|
| `github.profile.get` | `GET /github/profile` | 账号概览 |
| `github.repos.list` | `GET /github/repos` | 仓库列表（语言、star、push 时间、私有标记） |
| `github.repo.get` | `GET /github/repos/:owner/:name` | 详情 + README + 默认分支 |
| `github.repo.commits` | `GET /github/repos/:owner/:name/commits` | 最近提交 |
| `github.repo.tree` | `GET /github/repos/:owner/:name/tree` | 只读文件树 |
| `github.repo.file` | `GET /github/repos/:owner/:name/file` | 单文件正文（>256KB 拒绝，提示去 GitHub） |
| `github.activity.calendar` | `GET /github/activity/calendar` | 53 周贡献日历 |
| `github.activity.languages` | `GET /github/activity/languages` | 语言占比 |
| `github.inbox.list` | `GET /github/inbox` | 待 review PR / 指派 issue / 未读通知 |
| `github.inbox.digest` | `GET /github/inbox/digest` | AI 今日简报（生成后落库 30 分钟） |
| `github.search.repos` | `GET /github/search/repos` | 全站仓库搜索（支持 language / stars / pushed / topic）+ 在「我的仓库」内搜索 |
| `github.repo.ask` | `POST /github/repos/ask` | 针对仓库内容的问答（本地 LLM，不写 GitHub） |

### AI 工具（只注册 8 个，全部 `github:read`）

- `github.digest` —— 「今天 GitHub 有什么要我处理的」
- `github.repos.list` / `github.repo.get` / `github.repo.commits`
- `github.activity.calendar`
- `github.inbox` —— 待办清单
- `github.ask` —— 仓库内容问答
- `github.search` —— 找轮子（见第 5 节）

> 刻意少。工具数量直接推高意图路由的 prompt 成本（见 059），展示型模块不需要把 12 个接口全剖给模型。

---

## 5. GitHub 搜索与统一检索

### 5.1 能力边界（先讲清，避免误解）

- `GET /search/repositories`：搜的是**名称 / 描述 / topics**，默认**不搜 README 正文**。想搜正文得加 `in:readme` 限定符，效果不稳定且慢。
- `GET /search/code`：另一套能力。需认证、**10 次/分钟**、只搜默认分支、不支持正则、结果上限 1000 条。
- `GET /search/issues`：issue 与 PR 合并搜索，用 `is:pr` / `is:issue` 区分。
- 通用限制：结果最多返回 1000 条、`per_page` ≤ 100；认证后 **30 次/分钟**。

结论：**能搜，且结构远好于网页搜索**（星标、语言、更新时间、topics、archived 都是字段，不用解析 HTML）。但它不能当搜索引擎使，只能当「找轮子」使。

### 5.2 三档设计

| 档 | 接口 | 用途 | 成本 |
|---|---|---|---|
| 仓库搜索 | `github.search.repos` | 「找个 Go 的限流库」 | 1 请求/次，同 query 5 分钟快照 |
| 我的仓库内搜索 | `github.repos.list?q=` | 在自己仓库里找 | 本地过滤，0 请求 |
| 代码搜索（M4 可选） | `github.search.code` | 「我哪个项目里写过 X」 | 10/min，谨慎 |

关键取舍：**搜索只发一页，不翻页**。30 次/分钟的额度撑不起翻页体验，而用户真正要的是「前 10 个里有没有能用」。

### 5.3 统一检索：新增 `search.multi`，不改 `web.search`

```ts
search.multi(query, { sources: ["web", "github", "kb"] })
→ {
  query,
  web:    { title, url, snippet }[] | null,
  github: { fullName, description, stars, language, pushedAt, archived, topics, url }[] | null,
  kb:     { title, snippet }[] | null,
  degraded?: string[]   // 如 ["github:rate_limited"]
}
```

- **为什么新开一个**：`web.search` 是纯 HTML 抓取、无鉴权、无缓存；把 GitHub 混进去会变成「什么都依赖」的胖工具，还会破坏现有行为。分开后两边能独立降级——GitHub 撞限流时，网页结果照常返回。
- **并行扇出**：`Promise.allSettled`，单源失败只写进 `degraded`，不影响其它源。
- **路由怎么触发**：能力手册里加一句——查询含「开源 / 项目 / 库 / 框架 / 轮子 / repo / 源码」这类意图，或用户明确问「GitHub 上有没有」，走 `search.multi(sources:["web","github"])`；纯资讯、文档、新闻仍走 `web.search`。
- **去重**：GitHub 结果的 `html_url` 与 web 结果按 host+path 归一后去重，避免同一条出现两次。
- **渲染**：M1 先返回结构化 JSON（现有 `ToolCallBlock` 折叠块可读），AI 在正文给 3–5 张行内仓库卡（`owner/name · ★1.2k · Go · 更新于 3 天前`）。M3 再在 `ToolCallBlock` 加 `search.multi` 专用渲染，省一轮 token。

### 5.4 「找轮子」的默认策略

比裸搜有用得多的做法，是把自然语言翻成带限定符的查询：

| 用户说 | 实际查询 |
|---|---|
| 找个 Go 限流库 | `rate limit language:go stars:>200`，`sort=stars` |
| 有没有活跃的 RAG 项目 | `RAG stars:>500 pushed:>2026-05-01` |
| 找 React 表格组件 | `table language:typescript stars:>1000` |

结果侧必须带两个判断信号：**`pushed_at`（是不是死项目）** 和 **`archived`（是否已归档）**。这两项比 star 数更能说明「能不能拿来用」。

### 5.5 收藏（本地写，不是 GitHub 写）

搜到好仓库 → 一键进百宝箱（`toolbox_items` 链接类型）或项目文档。这属于本地写入，不违反只读原则；也是这个模块的个性化落点：GitHub 上搜到，工作台里攒着，下次对话能被 AI 检索到。

---

## 6. 权限

```ts
// roles.ts
owner: ["*"]
member: [..., "github:read"]     // 只读，member 拿到也无害
guest: []                         // 不给
```

不定义 `github:write`。这条是设计的一部分，不是遗漏。

---

## 7. 前端

`features/github/GithubPanel.tsx`，面板 id `gh`，路径 `~/gh`，标题「GitHub 观察窗」。
入口：HeroState chip「▸ GitHub 观察窗」、`/gh` 命令、⌘K「打开 GitHub 观察窗」。

**顶栏（常驻）**
```
@Effortful-lion   12 repos   ● 同步于 12:04   [↻ 刷新]   [↗ github.com]
```

**Tab 1 · 概览**
- 左：贡献热力图。53×7 网格，五档 `#00E59B` 透明度梯度（0.06 / 0.16 / 0.30 / 0.48 / 0.68），空格用 `--line`。hover 出 `2026-11-03 · 7 commits`。下方 mono：`1,284 contributions in the last year`。
- 右上：AI 今日简报，3 条为上限，每条一句话 + `↗`。空则显示 `// 今天没有需要你处理的事`。
- 右下：三个数字格——待 review / 指派给我 / 需关注（CI 失败仓库数）。

**Tab 2 · 仓库**
卡片网格（2 列）。每卡：
```
ai-workbench                     ● 私有
▸ go · node · typescript
★ 12   ⑂ 3      ● main · 2h ago
[近 30 天 commit sparkline]
```
点开进详情：README（react-markdown + remark-gfm 渲染）、文件树（可折叠）、最近 15 条提交时间轴（mono，`7f3a1c2 · feat: 快照层`）。所有项右上角带 `↗`。

**Tab 3 · 活跃**
- 语言占比环（`conic-gradient`，纯 CSS，不引图表库）
- 近 90 天每日提交柱（SVG，`var(--acc)`）
- 月度对比：本月 / 上月提交数

**Tab 4 · 收件**
三组，组内按时间倒序，全部只读 + 深链：
`待我 review (3)` / `指派给我 (5)` / `未读通知 (12)`

### 视觉约束

- 整个面板只有绿。CI 失败用琥珀 `#FFB000`（语义色允许），不与绿同屏制造第二个强调色。
- 卡片 `border-line` 1px，hover `border-acc` + `shadow-[0_0_12px_color-mix(in_srgb,var(--acc)_13%,transparent)]`，复用 HeroState 的既有写法。
- 热力图与 sparkline 手写，不引入图表库：零依赖，且能精确贴合终端绿。

---

## 8. 交互原则

**看在这里，做在那里。**

1. 双向都成立：面板里任何能产生动作的对象（仓库、PR、issue、run、commit）都带 `↗` 深链。
2. 简报里的每一条都是链接，不给"在工作台处理"的暗示。
3. AI 可以写「这个 PR 改了 12 个文件，主要在重写同步层，但没加测试」——生成的是**判断**，不是**动作**。
4. review 草稿同理：本地生成 markdown，用户复制去 GitHub 发。工作台不代发。

---

## 9. 安全

- **token 类型**：fine-grained PAT，只勾 `Contents: Read`、`Metadata: Read`、`Pull requests: Read`、`Issues: Read`、`Actions: Read`、`Notifications: Read`。不要 Classic token。
- **存储**：复用 `common/crypto.ts` 的 AES-256-GCM（与 `mail_accounts.password_enc` 同一套），存 `github_accounts.token_enc`。不写 `.env` 明文，虽然 `.env` 已 gitignore。
- **展示**：面板/接口只回 `ghp_••••1a2b`，绝不回明文 token。
- **缓存含私有内容**：`data/` 已在 `.gitignore`，快照落在 SQLite 里不出库；导出/备份时需注意。
- **限流失败不重试风暴**：403/429 记录 `retry_after`，期间直接吃缓存。

---

## 10. 里程碑

| 阶段 | 内容 | 预估 |
|---|---|---|
| **M1** | `GithubClient`（原生 fetch + ETag + Link 分页）、`github_snapshots` 表、profile / repos / commits 三个接口、面板骨架（仓库列表 + 顶栏状态） | 半天 |
| **M2** | 贡献热力图、语言环、仓库详情（README + 文件树 + 提交时间轴） | 1 天 |
| **M3** | 收件（2 条 search + notifications）、AI 简报、HeroState chip、`MODULE_META` 一行 | 半天 |
| **M3.5** | `github.search.repos` + `search.multi` 跨源检索 + 结果行卡渲染 | 半天 |
| **M4**（可选） | `github.ask` 仓库问答、review 草稿生成、代码搜索 | 半天 |

M1+M3 就能交付"每天会被打开的那一屏"；M2 是视觉资产。

不引 octokit：只用 GET，自己控 ETag 与快照更直接，省一个依赖。

---

## 11. 已知代价

- 数据有 15–60 分钟延迟（无 webhook），UI 用「同步于 …」标注，不掩盖。
- 只能看自己有权访问的仓库；组织和别人的仓库要额外授权。
- 代码搜索受 GitHub 侧限制（10 次/分钟），只在用户主动搜时用，不做后台索引。
- 大文件（>256KB）、大仓库 tree（GitHub 会截断）不完整展示，提示去 GitHub 看。
- 私有仓库内容会进本地缓存，换机器/清库要重新拉。
