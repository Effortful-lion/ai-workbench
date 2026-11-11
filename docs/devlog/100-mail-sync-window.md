# 100 · 邮件同步漏信修复（时间窗 + 自动同步）

日期：2026-11-10 ｜ 分支：main ｜ 类型：fix

## 一、现象

用户反馈「今天收到的验证码、广告等邮件没有出现在邮件面板」。

## 二、排查

查库得到两个事实：

```
mail_accounts.last_synced_at = 2026-11-06 20:40   ← 4 天没同步
mail_messages 最新 received_at = 2026-11-06 19:30
```

即：面板里的最后一封信停在 11-06，11-07 ~ 11-10 的信从未入库。手动触发一次 `POST /mail/sync` 后立刻新增 12 封（含腾讯云验证码、Apple 广告、Dependabot 等），说明 IMAP 链路本身没问题。

再看同步实现，有两个设计缺陷：

1. **只靠手动触发**：`MailPanel` 里只有「同步」按钮调用 `/mail/sync`，打开面板不会同步。几天不开就等于几天不同步。
2. **固定取最后 50 条序列号**：`fetch(`${exists-49}:*`)` 是「最新 50 封」的窗口。若两次同步之间到达超过 50 封（订阅号多的邮箱很容易），中间那批会被永久跳过——因为序列号窗口已经滑过去了，且不会回头补。
3. 附带隐患：循环体里任何一封 `simpleParser` 抛错都会冒泡到账户级 catch，导致**整批剩余邮件全部丢弃**，账户还被标记 error。

## 三、修复

### 1. 同步窗口改为按时间

```ts
const since = account.lastSyncedAt
  ? new Date(account.lastSyncedAt.getTime() - SYNC_OVERLAP_MS)   // 往前重叠 1 天
  : new Date(Date.now() - 30 * 86400_000);                        // 首次同步回看 30 天
const found = await client.search({ since }, { uid: true });
const uids = found.slice(-SYNC_LIMIT);                            // 上限 300 封
for await (const msg of client.fetch(uids, {...}, { uid: true })) { ... }
```

- 用 `SEARCH SINCE`（服务器 INTERNALDATE）而不是序列号范围，所以无论隔多久都能把中间的信捞回来；
- 重叠 1 天是为了抵消服务器时间戳与本机时钟/时区的偏差，已知邮件靠 `externalId`（`imap:<accountId>:<uid>`）幂等跳过，不会重复入库；
- 上限 300 封防止首次同步把超大邮箱一次拉爆（超出部分下轮继续，因为窗口是按时间滚动的）。

### 2. 单封失败不再拖垮整批

解析 + 落库整体包进 `try/catch`，失败的那封计入新增的 `parseErrors` 并 `continue`，其余邮件照常入库；老数据补 HTML 的分支也做了同样处理。

`MailSyncResult` 增加可选字段 `parseErrors?: number`，前端同步提示会显示「N 封解析失败已跳过」。

### 3. 打开面板自动增量同步

`MailPanel` 挂载时自动跑一次 `/mail/sync`：

- 会话内 3 分钟节流（`sessionStorage` 记时间戳），避免来回切面板反复拉；
- 只有 `created > 0` 才提示「已自动同步 N 封」，避免噪音；
- 失败静默，交给手动「同步」把错误完整报出来。

## 四、验证

- 三端构建通过（shared / server / web）。
- 真实账号回归：
  - 手动同步（旧代码）→ `created: 12, skipped: 38`，今天的验证码与广告进入库；
  - 新代码再同步 → `created: 0, skipped: 9, parseErrors: 0`，时间窗重叠的 9 封靠 externalId 幂等跳过，**无重复**；
  - 库内 `last_synced_at` 更新为当天；今天（11-10）入库 6 封，最新一封是 12:22 的「腾讯云邮箱验证码」。

## 五、遗留

- **UIDVALIDITY**：`externalId` 只用 UID，没有记录邮箱的 UIDVALIDITY。若服务端重置 UID（邮箱迁移/重建），旧 UID 会被新邮件复用，可能误判为「已存在」而漏信。彻底修需要在 `mail_accounts` 增列并在变化时重置映射，本次未做。
- 只同步 INBOX，`垃圾邮件`/`广告邮件` 等独立文件夹仍不进面板（QQ 邮箱的推广信有时会直接落进这类文件夹）。
- 自动同步是「打开面板时」，没有后台定时任务；不打开面板仍然不同步。
