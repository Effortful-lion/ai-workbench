# 091 · 邮件「全部已读」

日期：2026-11-10 ｜ 分支：main ｜ 类型：feature

## 一、需求

邮件管理加一个「全部已读」按钮：清空收件箱未读、顶栏红点同步消失。

## 二、后端

`POST /api/mail/messages/read-all`（`mail:write`）→ `MailService.markAllRead(userId)`。

难点不在改本地，而在 **IMAP 一致性**：`sync()` 里有「远端已读状态拉回本地」的逻辑，若只改数据库，下一轮同步会把 `\Seen` 未设置的邮件重新标成未读，红点又回来。

因此实现为：

1. 取该用户 `folder=inbox && isRead=false` 的邮件，按 `accountId` 分组；
2. 每组开**一次** IMAP 会话，`mailboxOpen("INBOX")` 后 `messageFlagsAdd(uids[], ["\\Seen"], { uid: true })` 批量打标（对比单条 `updateMessage` 的逐封建连，36 封就是 36 次连接）；
3. 回写成功才批量更新本地 `isRead=true`；
4. 某个账号回写失败 → **整批跳过**并在返回值 `skipped` 里计数，本地不动，避免与服务端分叉。

返回 `{ updated, skipped }`。

## 三、前端

`MailPanel` 工具栏在「同步收件箱」后新增「全部已读」：

- 禁用条件：`busy || digest.unread === 0`（没有未读时不可点，title 说明原因）；
- 点击后 `Promise.all([loadMessages(folder), reloadSummary()])`，后者会重新拉 digest 并广播 `aiwb:mail-changed`（`detail.unread`），TopBar 红点随之归零；
- 提示区分三种情况：`0 封`、`已读 N 封`、`N 封回写失败已跳过`。

## 四、验证

- `pnpm --filter @aiwb/server build`、`@aiwb/web build` 通过；
- 真实登录态打开 `/mail` 面板截图：按钮出现在 `同步收件箱` 与 `AI 分类` 之间，36 未读时可点击；
- 该账号是真实 QQ 邮箱（`imap.qq.com`，77 封收件箱 + 1 发件 + 1 回收站），执行会把未读在服务端标记 `\Seen`，属不可逆的外部副作用，先向用户确认后才执行。

**实跑结果（经用户授权）**：

| 项 | 值 |
|---|---|
| 接口返回 | `{"updated":36,"skipped":0}` |
| 耗时 | 1.28s（一次 IMAP 会话批量打标，非逐封） |
| `digest.unread` | 36 → **0** |
| 本地库 `inbox` | 77 封全部 `is_read=1` |
| `accounts[0].unreadCount` | 36 → **0** |
| 顶栏红点 | 消失；`全部已读` 按钮转为禁用态 |

## 五、遗留

- 只处理收件箱；垃圾箱/已归档不参与（与 digest 的 `unread` 口径一致）。
- 批量会话若中途超时，该账号整批跳过，需重试；未做逐封降级。
