# 096 · 首页节奏统一 / 对象存储仅 owner / Cookie 登录态

日期：2026-11-10 ｜ 分支：main ｜ 类型：fix + feat

## 一、来源

首页截图反馈三处：

1. `//` 注释行与上下内容的间距不统一（模型选择那块 8px/6px，快捷入口 10px，区块之间 20/24px 混用）；
2. 「对象存储」直达链接普通用户点进去没有账号；
3. 刷新页面必须重新输密码，登录态保持不住，同时又担心凭证泄露。

## 二、决策

### 1. 统一为两条间距规则

不再逐个调 `mt-*`，改成一条可复述的规则：

- **`//` 注释行 → 它的内容：10px**（`mb-2.5`，与「快捷入口」「最近提问」原有写法一致）；
- **块与块：24px**（容器 `gap-6`；区块内部 `space-y-6`）。

原实现的偏差：模型注释行用 `mt-2`（8px）+ 内层 `gap-1.5`（6px），而区块之间是 `space-y-5`（20px）。现在模型块改 `mt-6` + 注释行 `mb-2.5`，区块容器改 `space-y-6`，四条注释行（模型 / 快捷入口 / 最近提问，以及招呼语下的状态行）节奏一致。

没动的一处：招呼语下的 `// N 个模型在线` 是「招呼块的副标题」而非分区标题，与 `h1` 保持 8px（原型 `.sub{margin-top:14px}` 的收紧版），它到输入框的 24px 由容器 `gap-6` 提供。

### 2. 对象存储入口按角色收口

MinIO 控制台用 `ADMIN_USER/ADMIN_PASS` 登录，普通用户没有独立账号，展示出来只会得到一个登录页。改为仅 `role === "owner"` 渲染，与「配置种入的 admin 才拥有对象存储」的既有事实对齐。按角色判断而不是按用户名判断，避免以后出现第二个 owner 时漏配。

### 3. 登录态：refresh token 进 httpOnly Cookie

原实现把 accessToken + refreshToken 一起 `persist` 到 localStorage：

- 泄露面：refreshToken 有效期 7 天，任何 XSS 或本地读取都能拿走长期凭证；
- 体验差：accessToken 15 分钟过期，而刷新页面后代码里没有「用 refreshToken 换票」的启动逻辑，于是表现为「每次都要重新登录」。

改法：

- **refresh token 只走 Cookie**：`httpOnly` + `SameSite=Lax` + `Path=/api/auth` + 7 天。JS 读不到；只有换票/登出接口会携带，业务请求不带，缩小暴露面。
- **accessToken 只存内存**：`persist` 的 `partialize` 只写 `user`，`version: 2` 的 `migrate` 顺手清掉历史版本写在 localStorage 里的两个 token。
- **刷新页面自动恢复**：`App` 启动时若本地有 `user` 但没有 accessToken，先 `POST /auth/refresh`（带 Cookie）换票，再渲染；期间显示「正在恢复会话…」，避免闪一下登录页。
- **请求层兜底**：`api()` 发现缺 accessToken 或收到 401 时调用 `refreshSession()`，用模块级单飞 Promise 合并并发刷新——refresh token 是旋转的，并发刷新会互相作废。
- **旋转 + 滑动过期**：每次 refresh 都删旧 session 行、写新 Cookie，7 天窗口随使用顺延；登出时服务端删 session 并清 Cookie。
- 非浏览器客户端（CLI）不受影响：`/auth/refresh`、`/auth/login` 的响应体里仍返回 `tokens.refreshToken`，body 传参也仍被接受。

## 三、实现

| 文件 | 改动 |
|---|---|
| `apps/web/src/shell/HeroState.tsx` | 模型块 `mt-6` + 注释行 `mb-2.5`；区块 `space-y-6`；对象存储链接按 `user.role === "owner"` 渲染 |
| `apps/server/src/auth/refresh-cookie.ts` | 新增：Cookie 读写（自带 Cookie 头解析，不引入 `cookie-parser` / `@types/express`） |
| `apps/server/src/auth/auth.controller.ts` | register / login / refresh 下发 Cookie，logout 清除；refresh 支持 Cookie 或 body |
| `apps/web/src/stores/auth.ts` | 去掉 refreshToken；`partialize` 只存 user；`version: 2` + `migrate` |
| `apps/web/src/lib/api.ts` | 新增 `refreshSession()`（单飞）、缺失票据预刷新、401 重试一次 |
| `apps/web/src/App.tsx` | 启动换票 + 拿到 accessToken 后再连 Socket |
| `apps/web/src/shell/TopBar.tsx` | 登出不再传 refreshToken（服务端读 Cookie） |
| `apps/web/src/features/auth/LoginScreen.tsx` | 登录/发码请求 `credentials: "include"` |
| `.env.example` | 新增 `COOKIE_SECURE`（HTTPS 下必须为 true） |

## 四、验证

- `pnpm --filter @aiwb/server build`、`pnpm --filter @aiwb/web build` 通过，`read_lints` 0 诊断。
- Cookie 链路（本地 8700，curl）：
  - `POST /auth/login` → `Set-Cookie: aiwb_rt=...; Max-Age=604800; Path=/api/auth; HttpOnly; SameSite=Lax`；
  - 只带 Cookie `POST /auth/refresh`（body 为 `{}`）→ 返回新 accessToken 与用户；
  - `POST /auth/logout` → 清 Cookie；再刷新 → `400`（session 已删除）。
- 未验证：真实浏览器里「刷新页面自动恢复」的端到端表现（前端未起 dev server），逻辑上由 App 启动换票 + api 单飞兜底覆盖。

## 五、遗留

- 跨站部署（前端与 API 不同源）时 `SameSite=Lax` 不会带 Cookie，需要改 `SameSite=None; Secure` 并把 `origin` 收紧到具体域名；当前按同源 + Vite proxy 部署。
- 会话仍是「7 天滑动」，没有做「记住我 / 定期强制重登」，也没有设备列表与远程下线。
