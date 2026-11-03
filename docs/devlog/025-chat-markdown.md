# 025 · AI 回复 Markdown 渲染

- 日期：2026-11-02
- 状态：✅ 完成
- 前置：024 站内信/日程/流水线改动

## 目标

对话栏里的 AI 回答此前是纯文本直出，模型返回的 `#` 标题、`**加粗**`、列表、代码块、表格都原样显示。改为按 Markdown 语法识别并渲染，同时保留终端风格。

## 决策

| 问题 | 选择 | 原因 |
|------|------|------|
| 渲染方案 | `react-markdown` + `remark-gfm` | 语法覆盖完整，默认不解析原始 HTML，避免注入 |
| 单换行 | 追加 `remark-breaks` | AI 回复常用单换行分点；默认 Markdown 会折叠成空格，破坏排版 |
| 组件样式 | 逐元素映射成 Tailwind 类 | 复用现有 `text-tx` / `border-line` / `bg-bg2` / `text-acc` 变量，保持终端观感 |
| 用户消息 | 仍按纯文本 + `whitespace-pre-wrap` | 用户输入里的 `#` 不应被当成标题 |
| 哪个位置渲染 | 仅正式消息与流式缓冲区 | 工具输出保持等宽纯文本，避免被误解析 |

## 实现

- 新增 `apps/web/src/lib/markdown.tsx`：`MarkdownText` 组件，`components` 覆盖 `p/h1-h4/ul/ol/li/strong/em/del/a/hr/blockquote/pre/code/table/thead/th/td/img`。
  - 行内代码 `text-acc` + 细边框；代码块 `bg-bg2` 可横向滚动，内部 `code` 重置背景与内边距。
  - 表格外层包 `overflow-x-auto`，避免宽表撑破对话栏。
  - 链接统一 `target="_blank"` + `rel="noreferrer"`。
- `apps/web/src/shell/ChatColumn.tsx`：历史消息按角色分流，assistant 走 `MarkdownText`；流式输出同样走 `MarkdownText`，光标 `▌` 跟在内容之后。
- 依赖：`react-markdown`、`remark-gfm`、`remark-breaks`（仅 web）。

## 验证

用豆包模型真实生成一条含「二级标题 + 三项有序列表 + JS 代码块 + 两列表格」的回复，浏览器读取 DOM：

```
h2: ["渲染测试"]   ol li: 3   pre: 1   table: 1
raw "## ": false   raw "```": false
```

再用 mock 回复验证单换行：`br: 4`，`—— 以下为 mock 演示能力 ——` 下的 `▸` 各行保持独立成行。

验证用的测试会话（`hi`、两条 `请用 Markdown…`）已通过 `DELETE /api/chat/conversations/:id` 清理。

## 顺带

顶栏右侧控件统一 `h-[26px]`，修复「⌘K」与站内信铃铛高度不一致（实测两者均为 26px）。

## 遗留

- 代码块暂无语法高亮，长回答可考虑按语言接入轻量 highlighter。
- `react-markdown` 使主包增加约 165KB（gzip +77KB），后续可按需拆分为动态 chunk。
