# 100 · 展示型模块统一归属站点主人（普通用户只读 admin 公开内容）

日期：2026-11-10 ｜ 分支：main ｜ 类型：fix

## 一、现象

用普通账号登录后，五个展示型模块读到的是自己的空数据：

- 如何联系我：`/profile/contact` 返回自己的空联系信息
- 个人简历：`/resume/me` 返回空简历，且 `canEdit: true`
- 博客：文章列表为空
- 百宝箱：工具列表为空
- GitHub 观察窗：账号未绑定

## 二、原因

服务端 `JwtAuthGuard` 早已把非个人域接口的 `user.id` 映射为站点主人（admin），但 8700 端口上运行的是当天 00:46 启动的旧进程，`dist` 还是映射上线前的产物；后续重新构建过 `dist` 但进程没有重启，所以运行时仍走旧逻辑（按登录人自己取数）。重启后基础归属恢复，但还缺「只读 + 仅公开内容」的收口。

## 三、修复

### 1. 服务端 · 博客

- `GET /blog/posts`：非 owner 只返回 `status = published`，草稿与已下架不暴露
- `GET /blog/posts/:id/comments`：非 owner 只返回 `approved`，待审/拒绝/隐藏属于审核数据
- `GET /blog/moderation/comments`、`GET /blog/kb-links`：权限从 `blog:read` 收紧到 `blog:write`

### 2. 服务端 · GitHub

- `GET /github/inbox`、`GET /github/inbox/digest`：改为 `github:write`，通知与 AI 简报属于站点主人个人数据
- `GET /github/repos`：非 owner 过滤 `private` 仓库
- `GET /github/search/repos`：非 owner 查询追加 `is:public`
- `GET /github/search/code`：改为 `github:write`，避免命中私有仓库代码
- 仓库详情 / commits / activity / tree / file / ask / review-draft：新增 `assertPublicRepo()`，非 owner 访问私有仓库统一返回 404

### 3. 服务端 · 对话内 Agent 工具

`ChatGateway` 注入 `WorkspaceOwner`，工具执行上下文改用站点主人 id（会话与站内信仍按登录人自己），避免绕开 HTTP 守卫的 `blog.tools` 等直接查库工具读到普通用户的空数据。

### 4. 前端

- `TopBar` 联系预览卡路径显示 `/c/{admin}`（原来显示登录人自己的用户名，与实际跳转不一致）
- `GithubPanel`：非 owner 隐藏「收件」tab、数字格与 AI 简报，也不再请求 inbox / digest
- `BlogPanel`：非 owner 不请求审核队列、隐藏「去知识库」入口与「已下架」计数
- `PublicBlogPage`：`isOwner` 增加 `role === owner`，普通用户不再看到审核入口

写权限维持不变：五个模块仅 owner 可写，普通用户唯一可写的是公开页评论。

## 四、验证

`pnpm --filter @aiwb/shared build`、`pnpm --filter @aiwb/server build`、`web tsc --noEmit` 均通过；重启 8700 后用普通用户 token 实测：

| 接口 | admin | 普通用户 |
| --- | --- | --- |
| `GET /resume/me` | admin 简历，canEdit=true | admin 简历，canEdit=false |
| `GET /profile/contact` | 4 个渠道（含 2 个仅自己） | 2 个公开渠道 |
| `GET /toolbox/items` | 1 项 | 同 1 项 |
| `GET /blog/posts` | 2 篇（published + archived） | 1 篇 published |
| `GET /blog/posts/:id/comments` | 含 pending | 仅 approved |
| `GET /github/repos` | 35 个（8 私有） | 27 个（0 私有） |
| `GET /github/inbox` / `digest` | 200 | 403 |
| `GET /github/repos/.../私有仓库` | 200 | 404 |
| `POST /blog/from-kb`、`PATCH /blog/posts/:id`、`POST /github/account/token` | 200 | 403 |
| `POST /blog/public/admin/:slug/comments` | 201 | 201（唯一允许的写） |

## 五、遗留

- 百宝箱目前没有「公开/私有」字段，普通用户能看到站点主人的全部工具；若后续要区分，需要给 `toolbox_items` 增加可见性列。
- GitHub 个人资料、贡献日历、语言统计仍对普通用户展示（属于公开资料）；语言统计来自全部仓库，含私有仓库的语言名，不含仓库名。
