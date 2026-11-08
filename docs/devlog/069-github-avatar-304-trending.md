# 069 · 头像不显示根因修复 + 本周热门新项目榜

日期：2026-11-07
状态：已完成

## 用户反馈

1. 概览 Tab 的 GitHub 头像无法显示
2. AI 今日简报希望能拉 GitHub 的 star 榜
3. （问答）解释「活跃」Tab

## 头像根因（三层叠加，真实数据下首次暴露）

- **Bug A：304 分支是死代码**。`fetchSnapshot` 中 `!res.ok` 抛错在前、`if (res.status === 304)` 在后，而 304 的 `res.ok` 恰好是 false——任何 ETag 再验证命中 304 都会抛 `GitHub 304: ` 变 500。修复：304 判断移到 `!res.ok` 之前。
- **Bug B（致命）：快照命中路径重复过 parser**。快照库存的是**解析后**的 payload（camelCase），但缓存命中 / 304 / 限流回退三条路径都写了 `parser(JSON.parse(payload))`——parser 读的是 GitHub 原始字段名（`avatar_url`/`public_repos`/`html_url`），对已解析数据重解析全部得 `undefined`，JSON.stringify 丢弃这些字段。这解释了为什么响应里恰好丢 avatarUrl/publicRepos/htmlUrl，而 login/name/bio 等（原始与解析同名）幸存。修复：四处全部改为 `JSON.parse(payload) as T`，不再过 parser。此 bug 影响所有 kind（repos 的 fullName、commits 的 shortSha 等同样中招），此前没暴露是因为面板打开后快照未过期时用户没注意到字段缺失。
- **Bug C：commitActivity 空 body 崩溃**。GitHub 统计计算期间偶发 `200 + 空 body`，`res.json()` 抛 `Unexpected end of JSON input`。修复：`json().catch(() => null)`，null 按 202 同样处理（10 分钟短缓存空数组）。

## 热门新项目榜

用户想要的「star 榜」：**GitHub 没有官方 trending API**（github.com/trending 是网页，无接口）。采用官方搜索代理：`/search/repositories?q=created:>近7天&sort=stars&per_page=5`，快照 TTL 6h。

- 后端 `trending()` + `GET /github/trending`
- 概览右栏新增「本周热门新项目」卡（5 条：fullName ↗ / ★stars / 描述截断），副标题诚实标注「官方搜索代理，非 trending 页」
- 简报升级：trending top3 注入 digest 的 LLM 上下文（提示词允许「无待办时从热门挑一条」）；规则模板回退也在无待办时填一条热门项目；trending 拉取失败静默降级不影响简报

## 验证

- profile 缓存命中 + 强制刷新两条路径 avatarUrl 均正确返回
- `/github/trending` 真实数据：`KKKKhazix/agent-autoloop ★3873` 等 5 条
- 浏览器实测：头像 460×460 正常加载、热门榜卡片渲染、简报区域正常

## 教训

快照层的「读取路径不过 parser」是关键不变量：**parser 只用于 GitHub 原始响应，存储与读取只面对解析后数据**。本次 Bug B 是 M1 就存在的设计缺陷，测试期假数据少没踩到。
