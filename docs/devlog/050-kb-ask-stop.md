# 050 · kb 问答支持手动停止

- 日期：2026-11-06
- 状态：已完成

## 目标
AI 回答生成期间（quick 约 6–13s、deep 可达 20–30s），用户发现问错问题时无法中断，只能干等。需要在提问中提供「停止」按钮，点击后立即结束等待并恢复输入。

## 决策
1. **前端中止请求，不等服务端**：用 `AbortController` 中断 fetch。不发额外的「取消」接口——Nest 收不到取消指令，且 LightRAG 单 worker 的查询本身不提供中断能力，服务端即使知道也停不下来。
2. **修正 `api()` 的语义混淆**：原实现把 `TimeoutError` 与 `AbortError` 都翻译成「请求超时，请稍后重试」，导致用户主动停止会被显示成超时错误。改为只翻译 `TimeoutError`，`AbortError` 原样抛出，由调用方决定展示。
3. **停止不是错误**：该轮对话标记 `aborted`，界面显示「■ 已停止本次回答」，不写入 `error`。
4. **按钮复用同一位置**：提问中按钮变红为「■ 停止」，结束后恢复「⏎ 回答」，不新增第二套控件。

## 实现
- [api.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/lib/api.ts#L27-L36)：只将 `TimeoutError` 转成超时文案。
- [KbPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/kb/KbPanel.tsx#L150-L183)：`askAbort` 保存当前 `AbortController`，`ask()` 传入 `signal`，`stopAsk()` 调用 `abort()`；catch 分支区分 `AbortError`。
- [KbPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/kb/KbPanel.tsx#L370-L386)：提问中显示「■ 停止」，否则显示「⏎ 回答」。
- `Turn` 增加 `aborted?: boolean` 并新增「已停止」气泡。

## 验证
- `tsc --noEmit`：本次改动文件无新增错误。
- 交互路径（vite HMR 已生效）：提问 → 按钮变「■ 停止」→ 点击 → 该轮显示「已停止本次回答」、输入框立即恢复可编辑；不出现「请求超时」。
- 停止后的服务端请求仍会跑完并写入查询缓存，属预期：下次同问题可直接命中。

## 遗留
- 仅覆盖 kb 问答。主聊天页走 WebSocket 流式输出，如需停止要另做 `stop` 事件与后端取消，未纳入本次范围。
- 服务端（含 LightRAG）不会因客户端断开而中止计算，长查询仍会占住 LightRAG 队列；若后续队列拥堵明显，再评估在 LightRAG 侧加取消能力。
