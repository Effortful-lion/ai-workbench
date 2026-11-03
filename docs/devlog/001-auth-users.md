# 001 · 用户与认证（users/auth）

- 日期：2026-11-02
- 状态：已完成

## 目标

一期地基之首：注册/登录/续期/登出全链路，JWT + 三角色（owner/member/guest）落地，前端可登录并持久化会话。验收：首用户自动 owner、后续 member；错误凭证 401；refresh 旋转后旧令牌作废；浏览器走通登录→鉴权页→登出。

## 决策

- **scrypt 替代 bcrypt**：`node:crypto` 内置 `scryptSync` + `timingSafeEqual`，零原生依赖（避免 bcrypt 编译链），哈希串自带参数 `scrypt:N:r:p$salt$hash` 便于日后调参。
- **refresh token 不落 JWT**：随机 48 字节 hex 存 sessions 表，刷新即旋转（删旧发新），可服务端吊销；access 才是 15 分钟 JWT（sub/username/role）。
- **首用户即 owner**：注册时数表，空表 → owner，其后 → member；guest 不落库，纯未登录角色（对应"游客仅 ~/me ~/tools 只读"）。
- **守卫自行实现而非 passport**：[jwt-auth.guard.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/auth/jwt-auth.guard.ts) 一个文件搞定 verify + 注入 req.user + `@CurrentUser()` 参数装饰器；passport 对本项目过重。
- **前端 401 自愈**：[api.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/lib/api.ts) 封装——401 且持 refreshToken 时自动续期重放一次，失败则清会话回登录屏。

## 实现

- 服务端：[password.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/auth/password.ts)（scrypt）、[auth.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/auth/auth.service.ts)（register/login/refresh/logout）、[auth.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/auth/auth.controller.ts)（5 端点 + GET /me 受保护）、JwtModule 全局注册（dev 默认 secret，env `JWT_SECRET` 可覆盖）
- 数据：`drizzle-kit push` 建 users/sessions 两表（`data/workbench.db`）
- 前端：[stores/auth.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/auth.ts)（zustand persist `aiwb-auth`）、[LoginScreen.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/auth/LoginScreen.tsx)（终端窗口式登录/注册一体）、[App.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/App.tsx)（未登录→登录屏，已登录→boot 屏显示 user/role）

## 验证

- curl：`register lion→owner`、`register alice→member` ✓；错密码 401 `invalid credentials` ✓；无 token 401 `missing token` ✓；`GET /me` 带 token 返回用户 ✓；refresh 旋转成功且**旧 refresh token 复用被拒**（401）✓
- 浏览器子代理 3/3 PASS：`~/auth/login` 窗口渲染 ✓ → lion 登录进 boot 屏显示 `user: lion [owner]` + 绿 `● ok` ✓ → logout 回登录屏 ✓

## 遗留

- 登录限流/验证码未做（二期安全加固）；输入校验为手写最小版，后续模块多时引入 zod 统一。
- profile_json 字段已建但无编辑入口，随"个人简历"模块消费。
- sessions 表无定期清理过期行任务（低优先）。
