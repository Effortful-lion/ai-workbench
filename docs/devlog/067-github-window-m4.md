# 067 · GitHub 观察窗 M4（ask / review 草稿 / 代码搜索）+ shared 重建修复

日期：2026-11-07
状态：已完成（M4，GitHub 观察窗路线图收尾）

## 目标

实现设计稿 M4 三个可选能力：`github.ask` 仓库问答、review 草稿生成、`github.search.code` 代码搜索。三者都是「本地生成判断/草稿，不落 GitHub」。

## 决策

- **代码搜索滑动窗口限速**：GitHub 代码搜索硬限制 10 次/分钟，service 内存里按时间戳滑动窗口拦截（≥9 次/60s 直接报错，文案说明硬限制）；命中快照（5min）不占额度。422 时提示必须带限定符（`user:@me` / `repo:` / `language:`）。
- **ask / review 草稿不走快照**：问题与 PR 草稿是一次性生成物，缓存语义不清；底层 meta/README/commits 仍走各自快照，真正打 GitHub 的请求很少。
- **抽出 `llmOnce` 私有助手**：digest 内联的「取第一个真实模型 + chat + 失败返回 null」逻辑复用给 ask / reviewDraft，失败一律回退模板文案（含仓库/PR 链接），绝不白屏。
- **review 草稿上下文截断**：PR 描述 2000 字、每文件补丁 120 行、最多 20 个文件；LLM 输出固定三段结构（总结 / 主要变更 / 风险与建议），prompt 明确「只基于快照，不臆测没看到的代码」。响应带 `note: 本地生成，不代发`。

## 实现

- [github.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.service.ts)：`searchCode`（kind=search_repos，key=`code::q`，手动 getSnapshot/putSnapshot 以便限速只拦真实请求）、`llmOnce`、`ask`（meta+README 4k+15 commit → ≤200 字中文判断）、`reviewDraft`（PR meta+files → markdown 三段稿）。
- [github.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/github/github.controller.ts)：`GET /github/search/code?q=`、`POST /github/ask`、`POST /github/review-draft`。
- [operations.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/operations.ts)：补 `github.search.code` / `github.ask` / `github.review.draft`（POST，body 参数）。

## 重要修复：shared 构建产物过期（影响 M1–M3.5）

验证 M4 工具注册时发现 `/api/tools` 里**没有任何 `github.*` 工具**（130 个工具 0 个 github）。根因：操作目录经 `operationToolSchemas()` 从 `@aiwb/shared` 的 `dist/operations.js` 读取，而 shared 包自 M1 加入 GITHUB_OPERATIONS 后**从未重建**（`pnpm build` 只构建 server，不碰 packages/shared）。

修复：`cd packages/shared && pnpm build` → dist 里 github 相关从 0 → 56 处 → 重建 server 重启。现 `/api/tools` 共 144 个工具，github.* 14 个全部在册（profile/repos/repo/tree/file/commits/activity×2/inbox×2/search×2/ask/review.draft）。

**教训**：改动 `packages/shared` 后必须 `pnpm build` 该包再重启 server；server 的 nest build 不会级联构建 workspace 依赖。后续改 shared 的任何文件都要记得这一步。

## 验证

- 后端 build 通过；`search/code` / `ask` / `review-draft` 三条路由注册，无 token 均正确返回 404。
- `/api/tools`：github.* 从 0 → 14。
- 真实链路（代码搜索结果、ask 回答质量、review 草稿 markdown）需有效 PAT 由用户验证：「我哪个项目里写过 X」、「这个项目还支持吗」、「帮我起草 ai-workbench#12 的 review」。

## 遗留（路线图外，按需再做）

- trending（非官方 API 爬取，设计稿 §5.3 提及但路线图未列）。
- 代码搜索结果未做 text_matches 高亮片段（保持轻量，点击 ↗ 去 GitHub 看上下文）。
- ask/review 草稿未加面板 UI 入口，纯 AI 工具链路；如需按钮入口可后续加在仓库详情/PR 行。
- 限速窗口是单进程内存态，多实例部署需换 Redis；本地单用户足够。
