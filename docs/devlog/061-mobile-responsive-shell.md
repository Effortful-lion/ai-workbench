# 061 · 移动端适配：对话/面板互斥全屏 + 邮件阅读窗移动覆盖层

日期：2026-11-07

## 背景

手机/平板访问时两处核心体验断裂：

1. **Shell 工作态**：聊天栏固定 `w-[400px]`，375px 手机屏被聊天栏占满，面板区被挤出可视范围；
2. **邮件面板**：小屏单列堆叠，阅读窗被压在最长 560px 的邮件列表下方，选中邮件后看不到正文、也无回退导航。

## 决策

- **Shell：移动端聊天/面板互斥全屏，而非缩放挤压**。桌面（≥lg）保持 400px 聊天栏 + 面板同屏；<lg 时由 `mobileView` 决定谁独占屏幕，打开面板自动切面板视图、全部关闭自动回对话视图，右下角浮动按钮手动互切。平板的窄桌面窗口（960px）同样受益。
- **邮件阅读窗：移动端选中即全屏覆盖**。复用「选中态」做条件渲染——`selected` 时 `fixed inset-0 z-30` 全屏 + 头部「← 返回」按钮；未选中时移动端不渲染占位（`hidden lg:block`），桌面行为零改动。
- 只做布局层适配，不改动各面板内部业务逻辑；其他面板（pipe/notify 等）跟随 Shell 自动获得移动端可用性。

## 改动

- [ui.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/ui.ts)：新增 `mobileView: "chat" | "panel"`（不持久化）。
- [App.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/App.tsx)：`panelCount` 变化自动驱动 `mobileView`；聊天栏/面板区在 <lg 按 `mobileView` 互斥（`hidden`/`flex` + `lg:flex`），新增右下角浮动切换按钮（`lg:hidden`，z-40）。
- [MailPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/mail/MailPanel.tsx)：阅读窗选中时移动端全屏覆盖 + 「← 返回」；正文区 `min-h-0 flex-1` 适配覆盖层滚动、桌面保持 `lg:max-h-[560px]`；列表行小屏压缩为 `38px_84px` 列宽（`sm:` 恢复）。
- [TopBar.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/TopBar.tsx)：小屏隐藏 v0.1 版本号、⌘K 按钮与用户名徽章（`sm:`/`md:` 恢复），间距收紧。

## 验证

- `tsc --noEmit` 零错误。
- browser_use（960px 视口，<lg）：聊天栏隐藏、面板全屏、浮动「▤ 面板」按钮出现——平板行为符合预期；DOM 类名确认 ≥1024px 桌面端保持 400px 并排、浮动按钮 `lg:hidden`；顶栏元素完整。
- 邮件阅读窗移动覆盖层因测试收件箱为空未做点击级浏览器验证，逻辑为简单条件渲染，风险低。

## 遗留

- 其他面板内部（如 pipe 的横向 PipelineTrack）在极窄屏可能需要各自滚动/缩放微调，用到了再处理；
- 移动端手势（左右滑动切换聊天/面板、阅读窗滑动返回）未做，当前依赖按钮；
- 横屏平板（834–1023px 区间）落在移动布局，是否放宽断点到 `md` 需实机体验后定。
