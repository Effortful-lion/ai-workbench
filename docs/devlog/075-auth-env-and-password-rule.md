# 075 · 登录凭据统一与密码规则对齐 MinIO

日期：2026-11-08
状态：已完成

## 问题：admin/admin123 登录失败

**根因**：服务端从未加载仓库根目录 `.env`。
- `.env` 里 `ADMIN_PASS=admin123`，但 `node dist/main` 直接启动时进程环境没有该变量
- [auth.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/auth/auth.service.ts) 回落到 `process.env.ADMIN_PASS ?? "admin"`，于是种子管理员密码被同步成 `admin`（5 位）
- 而 MinIO 侧 [storage.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/storage/storage.service.ts) 默认 `admin123`，两边凭据分叉，与 `.env.example` 文档写的 `admin/admin123` 不一致

**修复**：新增 [env.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/env.ts)，在 `main.ts` 第一条 import 执行（早于 auth/storage 模块顶层默认值求值），解析根 `.env` 写入 `process.env`（已存在的变量不覆盖）。`ensureAdmin` 的种子密码同步逻辑随即把 admin 密码校正为 `admin123`。

## 密码规则对齐 MinIO

MinIO root 密码硬性要求 ≥ 8 位（`.env.example` 已注明）。网站管理员与 MinIO root 共用同一套凭据，因此：

- 注册校验 `≥6` → `≥8`（[auth.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/auth/auth.controller.ts)）
- 登录页注册模式加同样前端校验并给出提示（[LoginScreen.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/auth/LoginScreen.tsx)）

## 清理账号

只保留种子管理员 `admin`，删除其余全部账号与其会话（`sessions` 先删避免残留 FK 引用）。

说明：DB 只存 scrypt 哈希，**无法反推原密码长度**，因此无法按"密码是否 ≥8 位"精确筛选；按用户确认的范围做了全量清理。

## 验证

- `admin/admin123` 登录返回 `owner` + token
- `SELECT username, role FROM users` → 仅 `admin|owner`
- server build 通过、web tsc 零错误
- 服务端重启后 `/api/health` ok

## 注意

- 除 admin 外的账号已删除，其他浏览器上用旧账号的登录态会在 refresh token 失效后退出，重新用 `admin/admin123` 登录即可。
- 以后改凭据只改根 `.env` 一处，网站与 MinIO 同步生效。
