# 047 · AI 问答页面统一 Markdown 渲染

- 日期：2026-11-04
- 状态：已完成

## 目标
所有 AI 问答 / AI 生成内容的展示位置识别 Markdown 语法并正确渲染，而不是用 `whitespace-pre-wrap` 原样输出纯文本。

## 决策
- 复用既有组件 [markdown.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/lib/markdown.tsx) 的 `MarkdownText`（react-markdown + remarkGfm + remarkBreaks，终端风格样式，不解析原始 HTML），不引入第二套渲染方案。
- 只改「AI 生成内容」的展示位，按内容性质逐处甄别：
  - 改：KbPanel 的 `/kb/ask` 回答、PipePanel 流水线「最终产出」。
  - 不改：ChatColumn 的 user/tool 消息（用户输入与工具 JSON，主流聊天产品惯例）；ToolCallBlock（JSON）；PipePanel 步骤输出（与 error 混排的日志性质）；MailPanel / NotifyPanel 正文（真实邮件与站内信，渲染 md 会破坏原始格式）；ResumeCard（结构化简历数据）；ProjectsPanel 文档预览（用户手写内容，非 AI 问答，留作后续可选项）。

## 实现
- [KbPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/kb/KbPanel.tsx#L269-L271)：问答卡片回答区由 `whitespace-pre-wrap` 文本改为 `<MarkdownText text={t.result.answer} />`。
- [PipePanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/pipe/PipePanel.tsx#L730-L732)：运行详情「最终产出」改为 `<MarkdownText text={selectedRun.output} />`，保留外层 `max-h-[120px] overflow-y-auto` 滚动容器。
- 两文件均新增 `import { MarkdownText } from "../../lib/markdown";`。

## 验证
- `npx tsc --noEmit`（apps/web）：KbPanel / PipePanel / markdown 无新增报错；剩余 ToolCallBlock / TracePanel / commands.ts 报错为既有问题，与本次无关。
- vite HMR 自动生效；知识库问答页提问含 Markdown 语法的回答（标题、列表、代码块、表格）应渲染为对应样式。

## 遗留
- ProjectsPanel 文档预览（用户手写 Markdown 正文）仍是纯文本展示，如需要可同样接入 `MarkdownText`。
- PipePanel 步骤输出若后续确认以 AI 生成文本为主，可再评估渲染。
