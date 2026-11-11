# 101 · 邮件准实时增量同步

日期：2026-11-10 ｜ 分支：main ｜ 类型：feat

## 一、需求

「能不能做成实时增量同步？」——目前只有手动点「同步」或打开面板时拉一次，邮箱里来信后面板不会自己更新。

## 二、为什么不用 IMAP IDLE，而用「定时轮询 + 增量」

IMAP IDLE（RFC 2177）确实是真推送：连接建立后服务端有信就发 `* n EXISTS`。但落地成本高：

- **连接占用**：每个账户要长期保持一条 IMAP 连接；QQ/163 对并发连接数和空闲时长都有限制，多账户很容易被踢。
- **掉线与重连**：IDLE 有 29 分钟续期（`DONE` + 重新 IDLE）、代理/NAT 超时后要指数退避重连，状态机比轮询复杂一个量级。
- **收益有限**：增量同步一次只是 `SEARCH SINCE` + 少量 `FETCH`，60 秒一轮的开销可以忽略；对个人站「来信后 1 分钟内看到」已经够用。

所以选择：**服务端定时轮询 + 时间窗增量**，间隔可配。IDLE 留作后续可选增强。

## 三、实现

### 1. `MailSyncScheduler`（新增 `apps/server/src/mail/mail-sync.scheduler.ts`）

```ts
setInterval(() => tick(), MAIL_SYNC_INTERVAL_MS)   // 默认 60000ms，0 = 关闭
```

`tick()` 只挑「`lastSyncedAt` 为空或早于一个周期」且配了授权码的账户，按 owner 去重后调用 `MailService.sync(ownerId)`：

- 每次成功同步都会刷新 `lastSyncedAt`，所以不会轮空转；
- 单个 owner 失败只 `warn`，下一轮自然重试，不影响其他账户；
- `timer.unref()`：不阻塞进程退出（`nest start --watch` 重启更顺）。

### 2. 同步互斥

`MailService.sync()` 加了进程内 Set 锁：同一 owner 正在同步时直接返回「该账号正在同步中，请稍候」。原因：`mail_messages.external_id` 没有唯一约束，定时任务与手动同步并发时，两次都可能在插入前查不到同一封，从而重复入库。

### 3. 面板自动刷新

`MailPanel` 在可见状态下每 60 秒重拉一次列表与摘要（`document.visibilityState !== "visible"` 时跳过），配合服务端同步，新邮件会自己冒出来。

### 4. 配置

`.env.example` 新增：

```
MAIL_SYNC_INTERVAL_MS=60000
```

想更实时就调小（如 30000）；不想让服务端常连 IMAP 就设 0（保留手动同步与打开面板时同步）。

## 四、验证

- `@aiwb/server`、`@aiwb/web` 构建通过。
- 用 `MAIL_SYNC_INTERVAL_MS=5000` 起临时实例观察：
  - 启动日志：`▸ 邮件增量同步已开启：每 5s 检查一次`
  - `mail_accounts.last_synced_at` 连续推进（13:24:00 → 13:24:10），说明每轮都在跑；
  - `mail_messages` inbox 计数稳定在 89，**没有重复入库**（幂等 + 互斥都生效）。

## 五、遗留

- 仍是轮询语义：最坏延迟 = 同步间隔（默认 60s）。
- 只同步 INBOX，垃圾/广告独立文件夹不进面板。
- 未记录 UIDVALIDITY，邮箱迁移/重建后 UID 复用可能误判（见 100 的遗留）。
- 调度器是进程内的：多实例部署时每个实例都会跑，需要加分布式锁或只让一个实例启用（当前单机部署不涉及）。
