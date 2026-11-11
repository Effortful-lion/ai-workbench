# 102 · 面板内阅读页补评论框 + 评论入库清洗

日期：2026-11-10 ｜ 分支：main ｜ 类型：feature / security

## 一、问题定位

公开页 `/b/:username/:slug` 的评论框在 101 已改为常显，仍「没有评论框」的实际场景是**面板内阅读页**：
`BlogPanel` 打开文章时硬编码 `<BlogReader embedded readOnlyComments />`，`CommentThread` 的表单条件
`!readOnly && onSubmit` 直接为假，整块表单不渲染。101 的「遗留」里也记了这一条（需要按 post id 的登录态评论接口）。

## 二、改动

### 服务端（`apps/server/src/blog/`）

- `blog.service.ts`：把评论入库逻辑抽成私有 `createComment(post, ownerId, input, author)`，
  公开页 `addPublicComment` 与新增的 `addCommentByPostId` 共用同一条路径（校验/频控/压平/分流/通知完全一致）；
- `addCommentByPostId(postId, input, author)`：按文章 id 定位，站点主人可对草稿评论，其他人只允许已发布文章；
- `blog.controller.ts`：新增 `POST /blog/posts/:id/comments`（`JwtAuthGuard` + `blog:read`），
  身份取 token，异常原样传递（400/404 不被包装成 400 之外的状态）。

### 前端（`apps/web/src/features/blog/BlogPanel.tsx`）

- 去掉 `readOnlyComments`，传 `author={viewer.username}` 与 `onSubmitComment`；
- 提交走新接口；`approved` 后重拉该文章评论并刷新列表计数，`pending` 交给 `CommentThread` 提示「待作者审核」。

## 三、注入面处理

| 位置 | 处理 |
|---|---|
| 服务端入库 | 新增 `sanitizeComment()`：统一换行、剔除 C0 控制字符（保留 `\n\t`）、剔除零宽字符与双向覆盖符（`U+200B-200F`/`202A-202E`/`2066-2069`/`FEFF`）、折叠 3 个以上空行 |
| 服务端校验 | `content` 非字符串按空处理（脏类型不再 500）；原始长度 > 2000 直接 400；`parentId` 非字符串按顶级处理 |
| 输出 | 评论正文/昵称仍是 React 文本节点 + `whitespace-pre-wrap`，HTML 全转义；无 `dangerouslySetInnerHTML` |
| 文章正文 | `react-markdown` 未启用 `rehype-raw`，原始 HTML 不渲染 |
| 既有规则 | 10s 限频、60s 去重、敏感词/多链接/连续大写进待审 |

`<script>` 按字面量显示是预期行为（不是被转义后仍可执行），不需要再做 HTML 实体编码。

## 四、验证（本地 8831 临时实例，测完已关闭并清理数据）

- 未登录 `POST /api/blog/posts/:id/comments` → `401`（路由存在，鉴权生效）；
- 登录 admin 评论含 `<script>alert(1)</script>` + `\u0001` + `\u200b` → `201 approved`，
  落库内容为 `冒烟测试 <script>alert(1)</script> https://a.com http://b.com https://c.com`（控制字符/零宽字符已剔除）；
- `content` 传对象 → `400`；2001 字 → `400`；`parentId: 123` → `201`（按顶级处理）；
- 评论可通过 `GET /blog/posts/:id/comments` 读到，`DELETE /blog/comments/:id` 删除成功，评论总数回到 11；
- `pnpm --filter @aiwb/web exec tsc --noEmit`、`pnpm --filter @aiwb/server exec tsc --noEmit` 均通过。

## 五、遗留

- 面板内未登录访客的输入仍会丢（未做草稿暂存）；
- 普通用户评论命中规则的 `pending` 状态在面板内不会立刻上屏，只能看到提示条；
- 昵称的字符校验（长度/控制符）仍在账号体系侧，未在评论侧重复校验。
