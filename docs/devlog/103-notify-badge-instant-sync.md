# 103 · 站内信红点即时消除

日期：2026-11-10 ｜ 分支：main ｜ 类型：fix / ux

## 一、问题

顶栏站内信红点（未读数）只由 `TopBar` 的 60s 轮询刷新，面板内点开消息 / 标为未读 / 删除 / 全部已读后，
顶栏数字不动，最坏要等 60 秒才消失。邮件入口早已用 `aiwb:mail-changed` 事件双向同步，站内信缺这一层。

## 二、改动

### `apps/web/src/features/notify/NotifyPanel.tsx`

- 新增模块级 `publishUnread(unread)`：广播 `aiwb:notify-changed`（detail 带 `unread`）；
- `reload()` 拿到 digest 后广播，覆盖标为未读 / 删除 / 扫描 / 其他入口引起的数量变化；
- **乐观更新**：点开未读消息时先本地置为已读、未读数减一并广播，再发 `PATCH`；失败回滚并提示；
- 三个批量动作补即时广播：`toggleRead`（按 `isRead` 增减）、`removeItem`（删未读项减一）、`read-all`（直接归零），
  `reload()` 随后只做数据校准，红点不再等两次网络往返。

### `apps/web/src/shell/TopBar.tsx`

- 监听 `aiwb:notify-changed` 直接 `setUnread`；
- 订阅 `window focus`：切回页面时立即校准一次（在别的标签/窗口读过也能马上消红点）；
- 60s 轮询保留，只用于发现**服务端主动投递的新消息**（红点出现），不再承担消除延迟。

## 三、验证（playwright-cli，本地 8701 + 8700 现有 dev 环境）

先把一条站内信离线置为未读，顶栏显示「1 条未读站内信」，面板显示「1 未读」：

| 操作 | 结果 | 耗时 |
|---|---|---|
| 点开该条未读 | 顶栏 title「1 条未读站内信」→「站内信」，面板「0 未读」 | 22 ms |
| 详情区「标为未读」 | 顶栏 →「1 条未读站内信」 | 23 ms |
| 顶部「全部已读」 | 顶栏 →「站内信」，面板「0 未读」 | 21 ms |

测试结束时站内信回到全读状态，未留下脏数据；`pnpm --filter @aiwb/web exec tsc --noEmit` 通过。

## 四、遗留

- 新消息的**出现**仍靠 60s 轮询（服务端未做 notify 的 socket 推送），如需更实时需在 gateway 增加投递事件；
- 乐观更新的未读数按「-1」估算，与服务端真实值在极端并发下可能瞬时不一致，`reload()` 会校准。
