# 055 · 邮件顶栏入口 + 未读红点

- 日期：2026-11-06
- 状态：已完成

## 目标

邮件管理此前只有 Hero 快捷指令和命令面板两个入口，顶栏没有常驻入口，也没有未读提醒。对齐站内信（铃铛红点）的交互：顶栏加邮件图标入口，显示未读邮件数红点，点击直达邮件面板。

## 决策

- **复用现有 `/mail/digest`**：该接口是纯本地 DB 聚合（`select ... where ownerId`），不触发 IMAP 拉取，可安全轮询。
- **60s 轮询 + 面板事件即时同步**：与站内信一致的轮询节奏；邮件面板每次刷新摘要（读邮件、删除、同步后都会调用）广播 `aiwb:mail-changed`，顶栏立即更新红点，无需等下一轮。
- **不做独立 store**：红点只有顶栏一个消费者，`CustomEvent` 足够，避免为一个数字新增全局状态。
- **失败静默为 0**：guest/未配置邮箱时接口可能 403，红点按 0 处理，不弹错误。

## 实现

- [TopBar.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/TopBar.tsx#L16-L55)：新增 `mailUnread` 状态，与站内信未读数同 effect 并行轮询；监听 `aiwb:mail-changed`。
- 同文件 [L96-L119](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/TopBar.tsx#L96-L119)：信封图标按钮，点击 `openPanel("mail")`，红点样式与铃铛一致（>99 显示 `99+`）。
- [MailPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/mail/MailPanel.tsx#L133-L152)：`reloadSummary` 成功后广播未读数。

## 验证

- `pnpm --filter @aiwb/web build` 通过。
- 打开邮件面板后，`reloadSummary` 触发事件，顶栏红点即时变为 `digest.unread`；读一封后减 1，删除/同步后同步更新。

## 遗留

- 若后续需要「只在收件箱未读」还是「全部文件夹未读」的细分，可在红点旁加角标；当前沿用 digest 的全局 `unread`。
