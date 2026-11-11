# 097 · 只读展示站点主人内容 + 危险面板收口

日期：2026-11-10 ｜ 分支：main ｜ 类型：feat

## 一、目标

本站是「个人站 + 注册讨论」：内容（简历、博客、知识库、项目、客户、流水线…）都属于 admin，注册用户只浏览、只讨论。据此：

1. 登录用户能看到所有**非危险**模块的页面，页面上展示的是 **admin 的数据**；
2. 危险模块（涉及凭证/高权限）对普通用户不可见；
3. header 里用户唯一能改的是昵称；邮箱只作为「联系 admin」的渠道，用户之间不互相暴露。

## 二、决策

### 1. 数据归属在守卫层统一解析，而不是逐个 service 改

15 个模块的 service 都以 `userId` 作为 ownerId 过滤，逐个改调用点要动近百处且容易漏。改为在 `JwtAuthGuard` 里区分两个 id：

- `id`：**数据归属 id**。非 owner 用户访问共享内容时，解析为站点主人（`ADMIN_USER` 对应的用户，回退第一个 `role=owner`），带进程内缓存；
- `selfId`：真实登录用户 id，个人数据用（会话、站内信、昵称、评论身份）。

service 一行不改，controller 里传 `user.id` 的地方自然变成「读 admin 的数据」。

### 2. 哪些路径必须保留「本人」语义

守卫里用前缀白名单排除：

| 前缀 | 原因 |
|---|---|
| `/auth` | 改昵称、查自己 |
| `/notify` | 站内信是发给具体某个人的 |
| `/chat` | 会话记录属于对话者本人，映射到 admin 会把两个人的对话混在一起 |
| `/tools` | 自定义工具定义里有请求头/令牌，只认创建者 |
| `/blog/public` | 公开页发评论，身份必须是评论人自己 |

### 3. 危险面板只给站点主人

`OWNER_ONLY_PANELS = ["models", "mail", "aitools"]`（模型 API Key / 邮箱授权码与私人邮件 / 自定义工具令牌），对象存储入口已在 096 里按 owner 收口。前端四处入口同时过滤：首页 chips、⌘K 命令面板、CLI `open`、PanelZone（直接访问 hash 路由也只会看到拒绝态）。后端不依赖前端：对应模块的 `:read` 权限从 member 角色里移除，绕过前端也是 403。

### 4. member 权限收敛为只读

`ROLE_PERMISSIONS.member` 去掉所有写权限（kb/blog/tools/agents/storage 的 write 与 `tools:custom`、`storage:read`），只保留：

- `me:write`（改昵称）、`notify:write`（标记自己的站内信已读）；
- 各展示模块的 `:read`：kb / blog / projects / code / schedule / notify / models / agents / github，以及本次新增的 `commerce:read` / `crm:read` / `pipe:read`。

### 5. `me:write` 不能再兼职改简历/改联系信息

简历与联系信息原本都用 `me:write` 判定可写。member 保留 `me:write`（昵称需要），若不拆分就等于允许改 admin 的简历。改为模块级权限点：`resume:write`（简历 PUT / import / parse）、`contact:write`（联系信息 PUT），只有 owner 拥有。同时 `resume` 的 `canEdit`、`contact` 的 `canEdit` 都按角色返回 false。

### 6. 其他

- `POST /models/:id/test` 从 `models:read` 收紧到 `models:write`（member 能看模型列表就够了，不该能触发计费测试）。
- 顶栏「联系我」徽标只对 owner 显示：普通用户的 `/c/:username` 没有内容，也不该存在用户之间的联系方式。
- 商业化 / 客户管理 / 流水线三个面板从「owner 才能打开」改成「登录即可只读查看」，写按钮仍按 `role === "owner"` 隐藏；知识库、博客审核入口同样收敛到 owner。

## 三、实现

| 文件 | 改动 |
|---|---|
| `apps/server/src/common/workspace-owner.ts` | 新增：解析站点主人（ADMIN_USER → 第一个 owner），进程内缓存 |
| `apps/server/src/common/common.module.ts` | 新增 `@Global()` 模块，提供 `MailerService` / `WorkspaceOwner`（守卫被十几个模块引用，放 AuthModule 会解析不到依赖） |
| `apps/server/src/auth/jwt-auth.guard.ts` | `AuthUser` 拆 `id` / `selfId`；按前缀白名单决定是否映射到 owner |
| `apps/server/src/chat/chat.gateway.ts` | Socket 侧 `AuthUser` 补 `selfId` |
| `packages/shared/src/roles.ts` | member 改为只读权限集；新增 commerce/crm/pipe 读权限 |
| `packages/shared/src/contact.ts` | `OwnContactDto.canEdit` 改为 `boolean` |
| `contact/resume` 控制器与服务 | 写操作改用 `contact:write` / `resume:write`；`canEdit` 按角色 |
| `models.controller.ts` | `:id/test` 收紧到 `models:write` |
| `apps/web/src/lib/panel-access.ts` | 新增 `OWNER_ONLY_PANELS` + `canOpenPanel()` |
| `shell/HeroState.tsx` / `CommandPalette.tsx` / `CliOverlay.tsx` / `PanelZone.tsx` | 危险面板入口过滤 + 拒绝态 |
| `shell/TopBar.tsx` | 联系徽标仅 owner |
| `features/commerce`、`features/crm`、`features/pipe` | 面板可访问但只读 |
| `features/kb/KbPanel.tsx`、`features/blog/BlogPanel.tsx` | 写入口、评论审核 tab 收敛到 owner |

## 四、验证

`pnpm --filter @aiwb/server build`、`--filter @aiwb/web build` 通过；`read_lints` 0 诊断。

用真实注册的 member 账号（`role: member`）打本地临时实例（8811）：

| 请求 | 结果 |
|---|---|
| `GET /resume/me` | 200，返回 `username: admin`、`canEdit: false` |
| `GET /kb/documents` | 200，返回 admin 的文档 |
| `GET /projects` | 200，返回 `Admin-Project` |
| `GET /commerce/digest`、`/crm/digest`、`/pipe/digest` | 200 |
| `GET /agents`、`/code/repos`、`/schedule/tasks`、`/github/account` | 200 |
| `GET /notify/digest` | 200（自己的站内信，未被映射） |
| `GET /models` | 200（只含 DTO，不含明文 key） |
| `GET /mail/messages` | 403 |
| `PUT /profile/contact` | 403 |
| `GET /profile/contact` | `username: admin`、`canEdit: false` |

测试账号与验证码记录已清理。

## 五、遗留

- 数据归属靠**路径前缀**判断，新增模块时要记得确认是否属于共享内容（`jwt-auth.guard.ts` 里的 `PERSONAL_PREFIXES` 是唯一入口）。
- `WorkspaceOwner` 有进程内缓存：运行期改 `ADMIN_USER` 需要重启才生效（admin 种子本身也是启动时同步，行为一致）。
- 未做「用户自己的空间」（个人主页 / 自己的简历），当前明确是「所有人看 admin」。
- 前端 hash 路由如果直接带 `p=models`，普通用户会看到拒绝态而不是被重定向回首页。
