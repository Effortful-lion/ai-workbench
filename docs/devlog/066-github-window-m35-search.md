# 066 · GitHub 观察窗 M3.5（search.repos + search.multi 跨源检索）

日期：2026-11-07
状态：已完成（M3.5）

## 目标

实现设计稿 §5：找轮子链路「一句话 → 检索 → 有判断力的候选清单 → 人打开浏览器 → 结束」。补两个能力：`github.search.repos`（GitHub 全站仓库搜索）与 `search.multi`（web + github + kb 跨源统一检索）。

## 决策

- **search.repos 只发一页不翻页**：`per_page=10`，AI 用够了；真要翻页人自己去 github.com。同 query+sort 快照 5 分钟（kind=search_repos，key=`q::sort`）。结果带 `pushedAt` / `archived` 判断信号（半年没动 + 归档 = 谨慎采用），不让 AI 对着「唯一关键词」下断言。
- **search.multi 与 web.search 独立**：web.search 保持纯 HTML 抓取无鉴权；search.multi 聚合多源并去重。GitHub 撞限流时网页结果照常返回，两边独立降级。
- **扇出 Promise.allSettled**：单源失败只写 `degraded: ["source:reason"]`，不抛错；全源失败才抛。github 源未配 token 时走 degraded（`NotFoundException` 被 catch），web 照常。
- **去重按 host+path**：web 命中与 GitHub 仓库 URL 相同时丢 web 那条（GitHub 卡片信息更全）。归一规则：去协议 / www / 尾斜杠 / 小写。
- **search 模块常驻**：chat.gateway `ALWAYS_MODULES` 加 `search`，否则 `search.multi` 只在路由命中时可用——跨源检索应该像 web.search 一样随时可用。
- **搜索建议进系统提示词而非用户 query 加工**：工具 description 写明「找库时建议带限定符 language: / stars:> / pushed:>」，由模型自己组 query。

## 实现

后端：
- [github.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.service.ts) `searchRepos`：`GET /search/repositories?per_page=10`，fetchSnapshot ETag 复用，解析 fullName/description/stars/language/pushedAt/archived/topics/url。
- [github.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.controller.ts) `GET /github/search/repos?q=&sort=&refresh=`。
- [search.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/tools/search.tools.ts) `SearchTools.multi`（新文件）：sources 默认 `["web","github"]`，kb 可选；web 复用 `WebTools.search`、github 走 `searchRepos`、kb 走 `KbService.search`（hit.text 截 200 字）；返回 `{ query, web, github, kb, degraded? }`。
- [tools.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/tools/tools.module.ts)：注册 SearchTools，imports 加 GithubModule + KbModule（ToolsModule 是 @Global，被依赖方无环）。
- [operations.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/operations.ts)：补 `github.search.repos`。
- [chat.gateway.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/chat/chat.gateway.ts)：ALWAYS_MODULES 加 `search`。

前端（[ToolCallBlock.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/chat/ToolCallBlock.tsx)）：
- `resultSummary` 识别 search.multi 响应形状（`query` + web/github/kb 键），折叠头显示 `统一检索 · 网页 n · GitHub n · 降级 n`。
- 展开态 `MultiSearchCards` 组件：GitHub 行卡（fullName 链接 / 归档琥珀徽标 / description 截断 / language · ★stars · pushed 相对时间）、网页行（[host] title 链接）、知识库行、degraded 琥珀警告条；解析失败回落 raw JSON。
- 顺带修复预存类型错误：`groupMessages` 的 calls 数组显式标注 `toolMessage?: MessageDto`（原推断类型缺字段导致 line 39 TS2339）。

## 验证

- 后端 `pnpm build` 通过；`/github/search/repos` 无 token 返回 404；`/api/tools` 列表含 `search.multi`（与 web.search / kb.search 并列）。
- 前端 `tsc --noEmit`：ToolCallBlock 两个预存错误消除（剩余 TracePanel 错误与本次无关）。
- 浏览器：登录 → 首页聊天区渲染正常 → GitHub 观察窗正常，控制台无 JS 运行时错误。
- search.multi 真实扇出（含 GitHub 源）需有效 PAT 由用户在聊天中验证，如「找个 go 的 rate limit 库」。

## 遗留

- M4（可选）：`github.ask`（README + 近 20 commit → 本地 LLM 判断）、review 草稿、代码搜索（GraphQL，10 req/min 单独限速）、trending（非官方 API 爬取，滞后缓存）。
- search.multi 未做分页与结果排序融合（各源保持原顺序，GitHub 组排最前）；如需更智能排序可后续加 LLM rerank。
- kb 源默认不进 sources（保持检索轻量），用户说「查本地文档」时由模型显式加。
- GitHub 代码搜索（`search.code`）GraphQL 需单独限速 10/min，M4 再议。
