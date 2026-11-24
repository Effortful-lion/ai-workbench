# 111 · CLI 凭证改为 refresh token + 自动续期 + 真登出

- 日期：2026-11-12
- 状态：已完成

## 目标

`~/.aiwb/config.json` 原本只存 access token（JWT，15 分钟），既不续期也吊销不了：

1. 文件里的 token 登录 15 分钟后即失效，所谓"免登录"实际不存在，只是一份很快过期的缓存。
2. `aiwb logout` 只删本地文件，不调 `/auth/logout`，服务端 `sessions` 里的 refresh token 还能活 7 天。
3. 覆盖写已有文件时 `mode: 0o600` 不生效，权限可能被放宽。

验收：登录后 15 分钟仍可直接调用；logout 后旧 refresh token 无法再用；显式 `--token` 不污染本地文件。

## 决策

- **存 refresh token，而不是延长 access token 有效期**：refresh token 存在 `sessions` 表，服务端可旋转、可吊销，是唯一能"退出即失效"的方案；延长 JWT 有效期只会让"无法吊销"的问题更严重。
- **按需续期（401 触发），不在每次调用前解码 exp**：pre-check 需要处理时钟偏斜和签发时区问题，401 重试一次足够，且不引入额外依赖。代价是过期后的第一次调用多一次往返。
- **`/auth/*` 白名单不自动续期**：登录密码错、票已废本身就是 401，若此时也去换票，会拿旧 refresh token 静默重试并掩盖真实错误。
- **`--token` 显式覆盖时置 `noPersist`**：外来凭证不写进本地，也不参与续期，避免把临时调试用的 token 固化成持久登录态。
- **并发共用一次换票**：服务端每次 refresh 都会旋转 refresh token，两个并发 401 各自换票会导致后到的那个失败，用模块级 Promise 复用同一次结果。
- **logout 先吊销再删本地，吊销失败仍删本地**：服务端不可达时若坚持不删，用户被锁死在登不出的状态；改为打印失败原因后照常退出，保证不产生"假成功"。
- 被否决：把 refresh token 放进 macOS Keychain。跨平台需要回退分支，且本项目只在 macOS 上本地运行，收益不足以抵消实现成本，留作后续可选。

## 实现

- `apps/cli/src/config.ts`：`CliConfig` 增加 `refreshToken`、`noPersist`（运行期标记，不落盘）；`saveConfig()` 改为按白名单字段序列化，写后 `chmodSync 0o600` 兜住已存在文件的权限。
- `apps/cli/src/http.ts`：`callApi()` 拆出 `send()` 拿原始响应；401 且满足「有 refreshToken、非临时覆盖、不在 `NO_REFRESH_PATHS`」时调 `/auth/refresh` 换票后重试一次并写盘；`refreshTokens()` 用模块级 Promise 去重。
- `apps/cli/src/cli.ts`：`login` 同时保存 `accessToken` 与 `refreshToken`；`logout` 先调 `/auth/logout` 吊销再 `clearConfig()`；`--token` 分支置 `noPersist` 并清空 refreshToken；help 文案补充"不落盘、不自动续期"。

## 验证

- 构建：`pnpm --filter @aiwb/cli build` 通过。
- 临时 HOME 下 `aiwb login`：`config.json` 含 `server / token / refreshToken / username / role`，权限 `-rw-------`。
- 把本地 token 改成 `expired.invalid.token` 后 `aiwb whoami --raw`：自动换票成功，文件里的 token 被替换、refreshToken 同步旋转（长度仍 96）。
- `aiwb logout`：本地文件删除，exit 0；再用登出前的 refreshToken 请求 `POST /api/auth/refresh` → `401 refresh token expired`，确认服务端会话已吊销。
- 旧版 `~/.aiwb/config.json`（无 refreshToken、token 早已过期）：调用直接 401 并提示"凭证失效，请重新 aiwb login"，不会误触发换票。

## 遗留

- 旧配置文件不做迁移，用户重新 `aiwb login` 一次即可（旧 token 已过期，无可迁移内容）。
- 未做 macOS Keychain 方案。
- 多 profile（同时登录多个账号/多台后端）仍未支持，`--server` 只是进程内覆盖。
