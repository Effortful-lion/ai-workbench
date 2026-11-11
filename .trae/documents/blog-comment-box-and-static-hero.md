# 博客阅读页评论框 + 首页去掉启动流式动画

## Context

用户对当前站点提出 5 点反馈，其中 3 点需要改动：

* \#1 百宝箱无公开/私有字段、普通用户看到 admin 全部工具 —— 期望状态，**不改**。
* \#2 GitHub 语言统计含私有仓库语言名 —— 期望状态，**不改**。
* \#3 普通用户打开博客出现「✗ requires blog:write」—— 用户确认**现在已消失**（`PublicBlogPage` 的审核队列请求已限定 `isOwner`），**不改**。
* \#4 博客阅读页缺少评论输入框；同时需要防注入。
* \#5 首页首屏启动动画（终端启动行逐字打出 → 招呼语打字 → 各区块逐层淡入）导致每次刷新/切回首页都要等待，删除；输入框占位文案的打字提示保留。

目标：博客阅读页对所有人（含未登录）都显示可输入的评论框，提交时对未登录用户提示登录；评论渲染保持纯文本转义，杜绝 HTML/脚本注入。首页首屏立即完整渲染。

## 变更 1：博客阅读页评论框（`apps/web/src/features/blog/CommentThread.tsx`）

现状：`{!readOnly && onSubmit && ...}` 内，`author` 为空时只渲染「评论公开可见，发表评论需要登录 + 去登录」的一条提示，没有 textarea；因此未登录访客（以及面板内只读阅读）看不到评论框。

改法（保持现有视觉语言：1px 边框、等宽小字、绿色强调）：

1. 表单容器始终渲染（`!readOnly && onSubmit` 成立时），不再按 `author` 二选一。
2. 身份行：已登录显示头像 + `以 @author 身份评论`（保留现有逻辑与回复目标 chip）；未登录显示 `未登录 · 登录后即可发表评论`。
3. `textarea` 恒显示：未登录 placeholder 为「登录后参与讨论…」，已登录沿用 `回复 @xxx…` / `说点什么…`；`maxLength={2000}` 保留。
4. 提交按钮：未登录文案为「登录后发表」；点击时不发请求，改为展示提示「✗ 请先登录后再发表评论」并在同一行给出「去登录 →」按钮（沿用现有 `window.location.assign("/")` 登录入口）。
5. `submit()` 开头加 `if (!author)` 分支，避免未登录误发请求。
6. 评论正文继续用 React 文本节点渲染（`CommentRow` 的 `whitespace-pre-wrap`），不引入任何 `dangerouslySetInnerHTML`；`BlogMarkdown` 仅启用 `remark-gfm` / `remark-breaks`，未启用 `rehype-raw`，无需改动。服务端已有 1–2000 字、限频、去重、敏感词/多链接待审规则（`apps/server/src/blog/blog.service.ts` `addPublicComment`），本轮不重复实现，只在 devlog 记录安全结论。

面板内阅读页（`BlogPanel` 传 `readOnlyComments`）保持只读，不新增评论入口（用户选择「博客的阅读页」即公开页 `/b/:username/:slug`）。

## 变更 2：首页去掉启动流式动画（`apps/web/src/shell/HeroState.tsx`）

删除：

* `type Intro`、`useIntro()`（启动行逐字输出、招呼语打字、`reveal` 逐层淡入、光标闪烁）。
* `fade(n)` 及所有 `opacity-0 / pointer-events-none` 初始隐藏；`h1` 内的闪烁光标。
* 由 `intro.reveal >= 2` 决定的占位打字启动条件。

保留：

* `useTypedPlaceholder()`（输入框占位文案打字机）与 `PHS` 文案、`placeholder` 末尾 `▌` 光标。
* 启动行视觉（`bootLines(who)` 直接静态渲染三行，不再打字/等待），以及日期、招呼语、模型状态行、输入框、快捷入口、最近提问——全部首帧可见。
* 招呼语仍拆成「前缀 + 昵称异色 + 感叹号」，只是直接完整渲染：`{greetHead}<span className="text-acc">{name}</span>！`。

注意清理不再使用的变量，避免 tsc 报未使用。

## 验证

1. `pnpm --filter @aiwb/web exec tsc --noEmit`（`packages/shared`、server 无改动）。
2. 本地 dev（web 8701 / server 8700 已在运行）：未登录访问 `/b/<owner>/<slug>`：
   * 评论区出现输入框，placeholder 为「登录后参与讨论…」；
   * 点击「登录后发表」出现「请先登录」提示与「去登录」入口，无网络请求；
   * 评论正文中的 `<script>`、`**粗体**` 等按纯文本显示（不发散）。
3. 已登录用户发表评论：仍走 `POST /blog/public/:username/:slug/comments`，已通过评论刷新到第一页；待审提示不变。
4. 首页在刷新与从其他路由返回时，启动行/招呼语/输入框/快捷入口一次性完整出现，只有输入框占位文案在打字；`prefers-reduced-motion` 下占位文案显示首条。
5. 更新 `docs/devlog/101-*.md`，记录需求、改动文件、安全结论与验证结果。
