# 095 · 邮箱验证码注册与昵称体系

日期：2026-11-10 ｜ 分支：main ｜ 类型：feat

## 一、目标

1. 账号只有两类来源：`ADMIN_USER` 配置种入的管理员，以及**邮箱 + 密码 + 验证码**注册的普通用户；不再允许自助填用户名。
2. 注册后自动生成账号与昵称，昵称展示在首页招呼、顶栏、CLI、评论区，并支持本人修改。

## 二、决策

- **用户名仍保留，由邮箱前缀派生**：`/p/:username`、`/t/:username`、`/b/:username/:slug` 等公开页路径都以 username 为键，直接改成邮箱会污染 URL（含 `@`、可能很长）。所以 `username` 是「系统生成的句柄」，`nickname` 是「可改的展示名」，两者分离。撞名自动追加 `-2/-3…`。
- **昵称自动生成而不是让用户填**：注册表单只留 邮箱 / 密码 / 验证码 三格，少一步决策；默认昵称用「形容词 + 名词」组合（例：`沉默的沙丘`），撞名重抽，最多 12 次后加数字后缀。
- **验证码落库而不是内存**：服务重启后仍可校验，且天然支持多实例；同邮箱只保留最新一条有效码，旧码即时 `consumed_at` 作废。10 分钟有效、60 秒冷却、错 5 次作废（`attempts` 计数），冷却与错误次数都在服务端判定，前端倒计时只是提示。
- **发信走站点级 SMTP，不复用 mail 模块**：mail 模块的 `sendMail` 依赖用户自己配置的 `mail_accounts`（每用户授权码，且方法是 `private`），拿它发注册码等于要求「先登录才能收注册码」。新增 `common/mailer.service.ts`，只读 env（`SMTP_HOST/PORT/SECURE/USER/PASS/FROM`），`send()` 返回 `boolean`。
- **未配置 SMTP 时的开发兜底**：不抛错，验证码打到服务端日志，同时在 `/auth/code` 响应里回显 `devCode`，注册页直接填入并提示「开发模式」。生产交给 env，不会出现该字段。
- **昵称改动不进 token**：JWT 里保持 `{sub, username, role}`，昵称需要新鲜值的地方（`GET /auth/me`、评论落库）直接查库。避免「改完昵称要等 15 分钟 token 过期」的坑。
- **评论昵称存快照**：`blog_comments.nickname` 写入时取当前昵称，历史评论不随改名变化（评论是发言记录，不是用户名片）。
- **不新增 `me:write` 之外的权限**：改昵称只要求登录（`JwtAuthGuard`），但操作目录里给 `auth.nickname` 标了 `me:write`，member 角色补上该权限点，让 CLI/Agent 侧过滤后仍可见。

## 三、实现

### 服务端

| 文件 | 改动 |
|---|---|
| `apps/server/src/db/schema.ts` | `users` 增 `email`（唯一，可空）、`nickname`（可空，空则回退 username）；新增 `email_codes` 表 |
| `apps/server/src/common/mailer.service.ts` | 新增：站点级 SMTP 发信，未配置返回 `false` |
| `apps/server/src/auth/auth.service.ts` | 新增 `sendRegisterCode` / `consumeCode` / `uniqueUsername` / `uniqueNickname` / `me` / `updateNickname`；`register` 改为邮箱+验证码；`login` 支持账号或邮箱；`toPublic` 输出 email/nickname |
| `apps/server/src/auth/auth.controller.ts` | 新增 `POST /auth/code`、`PATCH /auth/me`；`GET /auth/me` 改为查库返回 |
| `apps/server/src/auth/auth.module.ts` | 注册并导出 `MailerService` |
| `apps/server/src/blog/blog.service.ts` | 评论昵称与回复通知改用最新昵称 |

接口：

- `POST /api/auth/code` `{email}` → `{ sent, ttl, devCode? }`
- `POST /api/auth/register` `{email, password, code}` → `{user, tokens}`（`user.username` 自动派生、`user.nickname` 自动生成）
- `POST /api/auth/login` `{username, password}`（`username` 可传账号或邮箱）
- `GET /api/auth/me` / `PATCH /api/auth/me` `{nickname}`

### 共享层

- 新增 `packages/shared/src/auth.ts`：`AuthUserDto`（id / username / email / nickname / role）、`AuthSessionDto`、`SendCodeResult`，并在 `index.ts` 导出。
- `roles.ts`：member 补 `me:write`。
- `operations.ts`：`AUTH_OPERATIONS` 增 `auth.code`、`auth.nickname`，`auth.register` 参数换成 email/password/code，顺手修正摘要里「密码 ≥6」的旧描述（实际 ≥8）。

### 前端

| 文件 | 改动 |
|---|---|
| `features/auth/LoginScreen.tsx` | 注册态改为 `mail / pass / code` 三行，带「获取验证码」按钮 + 60 秒倒计时 + 开发态回显；登录态占位改「账号名或邮箱」 |
| `stores/auth.ts` | `AuthUser` 增 `email?` / `nickname?`；新增 `setUser` 与 `displayName()`（昵称优先、回退账号名） |
| `shell/NicknameDialog.tsx` | 新增昵称修改弹窗（Esc 关闭、Enter 保存、20 字上限） |
| `shell/TopBar.tsx` | 身份块改为按钮，展示昵称 + 角色，点击开弹窗 |
| `shell/HeroState.tsx` | 首页招呼语用昵称，启动行提示符仍用账号名 |
| `shell/CliOverlay.tsx` | `whoami` 输出「昵称（账号）」与邮箱 |

数据库：`make db-push`（新增列与表，无数据丢失）。

## 四、验证

- `pnpm --filter @aiwb/server build`、`pnpm --filter @aiwb/web build` 均通过；`read_lints` 0 诊断。
- 接口冒烟（本地 8700，未配 SMTP）：
  - `POST /auth/code` → `devCode: 568726`；
  - `POST /auth/register` → `username: smoke1794242531`、`nickname: 沉默的沙丘`、`role: member`，返回 tokens；
  - `PATCH /auth/me {nickname:"深夜的灯塔"}` → 返回新昵称，`GET /auth/me` 一致；
  - 邮箱登录通过；`admin/admin123` 登录仍可用（昵称回退为 `admin`）。
  - 测试用户与验证码记录已清理。
- 未验证：真实 SMTP 投递（本地没有可用发件账号），只验证了未配置分支。

## 五、遗留

- `.env` 需自行补 `SMTP_*` 才能真正收信；不补则始终走控制台/回显兜底，**上线前必须配置**，否则任何人都能拿到注册验证码。
- 目前没有「忘记密码 / 改密码」链路，`email_codes.purpose` 预留了 `reset`。
- 评论昵称是快照，改名后历史评论仍显示旧昵称；如需即时同步要改成按 `user_id` 联表取。
