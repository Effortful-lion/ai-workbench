# 074 · 体验修复：删除即时响应 / 卡片整块可点 / 去横向滚动 / 简历解析与行号

日期：2026-11-08
状态：已完成

## 1. 删除后界面不刷新（模型管理等多个模块）

**现象**：删除模型后卡片仍在，刷新页面才消失；服务端实际已删除。

**根因**：`api()` 统一用 `res.json()` 解析响应。NestJS 对 `void` 返回（DELETE 等）发送 **空响应体**，`res.json()` 抛 `SyntaxError`，导致调用方 `await api(...)` 之后紧跟的 `await reload()` 永远执行不到。

**修复**：[api.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/lib/api.ts) 改为先读 `res.text()`：空串返回 `undefined`，非 JSON 原样返回。所有 DELETE 调用（模型、知识库文档、Agent 等）一并恢复。
额外：模型 `remove` 改为**先本地移除再请求**（即时反馈），失败走 toast 回滚后的 `reload()` 收敛。

## 2. 卡片整块可点击

统一原则：**卡片/行本身是点击目标，小按钮只是快捷方式**。

- 知识库文档行：整行点击 → 打开归档原文抽屉（行内「👁 原文 / ↻ 重试 / ✗ 删除」均加了 `stopPropagation`，不会误触发）
- GitHub AI 今日简报：每条简报整行是 `<a>` → 直接打开对应 GitHub 链接
- GitHub 收件箱：整行 `<a>` → 打开 issue/PR
- GitHub 最近提交：整行 `<a>` → 打开 commit

## 3. GitHub 观察窗去除横向滚动

- 热力图：`overflow-x-auto` + 固定 11px 单元格改为 **52 周 flex 均分布局**（每周 `flex-1`，单元格 `w-full`），窄屏自动压缩不滚动
- 90 天提交柱状图：固定 `width=720` 改为 `viewBox` + `w-full` 自适应缩放

## 4. 个人简历

### 解析方式（回答「是不是 OCR」）

**不是 OCR，也没有走 LLM**。链路为：

1. 取文本：PDF 走 `unpdf` 抽文本层、Word 走 `mammoth`、txt/md 直读（[file-text.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/common/file-text.ts)）
2. 规则解析：按章节标题正则切块，再用启发式拆「公司/职位/时间段」（[resume.parser.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/resume/resume.parser.ts)）

所以扫描版 PDF（纯图片）会解析为空；本机未装 OCR。

### 解析不完整 / 标题错位

- 标题归一化：支持「一、工作经历」「1. 项目经历」「（2）教育背景」「项目经历 / Projects」「教育经历（重点）」等写法（去编号、装饰符、尾部括号，按 `/|｜` 拆双语标题），长度上限 20→32，避免整行被判成正文掉进上一章节
- 别名扩充：校园经历/社会实践、作品集/主要项目、技能证书/荣誉奖项、个人评价/自我描述等
- 数据不丢：章节首行不是标题时不再跳过，而是开空头条目承接正文；经历/教育两侧从正文回捞公司名/学校名，完全没有头部时保留首个短行
- 保留过滤条件放宽（有 highlights 也算有效经历）

### 编辑器行号

[JSON 编辑器](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/resume/ResumePanel.tsx) 改为带行号栏的 `textarea`：行号与文本同字号/行高，纵向滚动同步（不换行 `wrap="off"`，保证行号与逻辑行严格对齐）。JSON 报错时从 `position` / `line` 换算出**第 N 行**并入提示。

## 顺手修复

- [TracePanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/chat/TracePanel.tsx) `executions/latest` 返回单对象而非数组，类型改正（此前阻塞 web tsc）

## 验证

- `pnpm --filter @aiwb/server build` 通过；web `tsc --noEmit` 零错误
- 解析样例（编号+双语+括号标题、无公司行）输出结构正确：experience / projects / education / skills 全部归位
- 服务端已重启，`/api/health` ok；Web 8701 正常

## 遗留

- 纯图片扫描 PDF 需 OCR 才能解析，当前不支持；如需要可接 OCR 服务或走多模态模型。
