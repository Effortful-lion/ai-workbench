# 101 · 博客阅读页常显评论框 + 首页去掉启动流式动画

日期：2026-11-10 ｜ 分支：main ｜ 类型：feature / fix

## 一、需求（本轮 5 点反馈的取舍）

| # | 反馈 | 结论 |
|---|---|---|
| 1 | 百宝箱没有公开/私有字段，普通用户会看到 admin 全部工具 | 期望状态，不改 |
| 2 | GitHub 语言统计仍基于全部仓库（只含语言名） | 期望状态，不改 |
| 3 | 普通用户打开博客出现「✗ requires blog:write」 | 已不存在（公开页审核队列请求已限定 `isOwner`），不改 |
| 4 | 评论功能已有但阅读页没有评论框；注意注入 | 见下文 |
| 5 | 删除首页启动流式刷新，保留输入框占位打字 | 见下文 |

## 二、博客阅读页评论框

**问题**：`CommentThread` 的输入表单按 `author` 二选一——已登录渲染 textarea，未登录只渲染一条「去登录」提示。未登录访客因此看不到评论框，误以为评论功能缺失。

**改动**（`apps/web/src/features/blog/CommentThread.tsx`）：

- 表单容器在 `!readOnly && onSubmit` 时始终渲染，不再按登录态切换整块；
- 身份行：已登录仍是「头像 + 以 @username 身份评论」；未登录显示「未登录 · 登录后即可发表评论」；
- textarea 常显，未登录 placeholder 为「登录后参与讨论…」，`maxLength=2000` 不变；
- 提交按钮未登录文案为「登录后发表」，点击不发请求，只提示「✗ 请先登录后再发表评论」并在同一行给出「去登录 →」；重新输入时提示自动清除；
- `submit()` 开头增加 `if (!author)` 早退，保证未登录不触发 `POST /blog/public/.../comments`；
- 面板内阅读页（`BlogPanel` 传 `readOnlyComments`）保持只读，评论入口只出现在公开阅读页 `/b/:username/:slug`。

**注入面结论（本轮核查，无新增风险）**：

| 位置 | 渲染方式 | 结论 |
|---|---|---|
| 评论正文 | React 文本节点 + `whitespace-pre-wrap` | HTML 全转义，`<script>` / `<b>` 只显示字面量 |
| 评论昵称 / 回复目标 | 文本节点 | 同上 |
| 文章正文 | `react-markdown` + `remark-gfm` / `remark-breaks` | 未启用 `rehype-raw`，原始 HTML 不渲染；链接协议由默认 urlTransform 过滤 |
| 服务端 | `addPublicComment`：1–2000 字、10s 限频、60s 去重、敏感词/多链接待审 | 已有规则，无需重复 |

## 三、首页去掉启动流式动画

**问题**：`HeroState` 的首屏启动序列（终端启动行逐字打出 → 招呼语打字 → 副标题/输入框/快捷入口/最近提问逐层淡入）导致每次刷新或切回首页都要等一段时间。

**改动**（`apps/web/src/shell/HeroState.tsx`）：

- 删除 `type Intro`、`useIntro()`、`fade(n)` 与全部 `opacity-0 / pointer-events-none` 初始隐藏、`h1` 闪烁光标；
- 启动行改为 `bootLines()` 静态渲染三行，日期 / 招呼语 / 模型状态 / 输入框 / 快捷入口 / 最近提问首帧完整可见；
- 招呼语直接渲染「前缀 + 昵称异色 + ！」，不再按打字长度切片；
- **保留** `useTypedPlaceholder()`：输入框占位文案仍逐字打出（末字带 `▌` 光标），`prefers-reduced-motion` 下固定显示首条。

## 四、验证

- `pnpm --filter @aiwb/web exec tsc --noEmit` 通过（shared/server 无改动）。
- 浏览器（未登录，`/b/admin/7823900a`）：评论区出现 placeholder「登录后参与讨论…」的 textarea；输入内容后点击「登录后发表」，出现「✗ 请先登录后再发表评论」与「去登录」，网络面板无 `POST /api/blog/public/.../comments`。
- 浏览器（admin 登录首页）：首屏「快捷入口」与输入框立即完整显示，启动行三行静态含 `admin@workbench`，输入框 placeholder 仍在逐字变化。
- 已登录评论链路未改动（仍走 `POST /blog/public/:username/:slug/comments`，通过后重拉第一页）。

## 五、遗留

- 未登录输入的内容在跳去登录后会丢失（未做草稿暂存）；
- 面板内阅读页仍为只读评论区，若后续要在面板内直接评论，需要按 post id 增加登录态评论接口。
