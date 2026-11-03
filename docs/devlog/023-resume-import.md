# 023 · 简历导入（粘贴文本 / PDF / Word）

- 日期：2026-11-02
- 状态：✅ 完成
- 前置：022 预算与启动稳定性修复

## 目标

简历不再只能手填：支持直接粘贴文字，或上传 PDF / Word / TXT / Markdown，由后端抽取文本并解析成档案卡结构，前端以终端风格渲染预览后再写入。

## 决策

| 问题 | 选择 | 原因 |
|------|------|------|
| 谁负责解析 | 后端 `ResumeService.parseImport` | 前端只需渲染；同一份规则可被 AI 工具复用 |
| PDF 抽取库 | `unpdf` | 纯函数、无原生依赖；CJS 产物里用 `new Function("s","return import(s)")` 动态加载 ESM |
| Word 抽取库 | `mammoth` | 只取纯文本，避免样式解析开销 |
| 导入是否直接落库 | 否，两段式 | 先返回预览，用户确认后再 `PUT /resume/me`，避免误覆盖 |
| 解析失败 | 不报 500，返回空字段 + 用户手动补 | 简历格式无标准，硬失败体验差 |

## 实现

- `apps/server/src/resume/resume.parser.ts`（新增）：章节识别（工作/项目/教育/技能/简介）、`splitFields`、`firstField`、日期与条目正则，产出 `ResumeProfile`。
  - 入口 `parseResumeText()` 先做 `NFKC` 归一：PDF 常把汉字抽成康熙部首（`⼯`/`⼤`/`⾼`），不归一会导致章节标题匹配不上、工作经历整段丢失。
- `apps/server/src/resume/resume.extract.ts`（新增）：`extractResumeText()` 按扩展名分流 pdf/docx/txt/md，`MAX_UPLOAD_BYTES = 10MB`。
- `apps/server/src/resume/resume.service.ts`：`parseImport()`，`normalizeProfile()` 增加 `education[]`。
- `apps/server/src/resume/resume.controller.ts`：`POST /resume/import`（multipart `file`）、`POST /resume/parse`（`{ text }`），均要求 `me:write`。
- `packages/shared/src/resume.ts`：新增 `ResumeEducation`、`ResumeProfile.education[]`、`ResumeImportResult`。
- 前端：`apps/web/src/features/resume/ResumePanel.tsx` 增加导入面板（文件 / 粘贴 → 预览 → 写入）；`ResumeTerminal.tsx` 增加 `cat education.log` 段。
- `apps/web/src/lib/api.ts`：`FormData` 请求不再强制 `content-type: application/json`。
- `apps/server/src/main.ts`：JSON body 上限调到 `512kb`，容纳长文本粘贴。

## 验证

| 输入 | 结果 |
|------|------|
| `.txt` | source=text chars=281 · 张三 · edu 2 · exp 1 · skills 1 |
| `.docx` | source=docx chars=165 · 李四 · edu 1 · exp 1 · skills 1 |
| `.pdf`（cupsfilter 生成，汉字为康熙部首） | source=pdf chars=270 · 张三 · edu 2 · exp 1 · skills 1 |

修复前该 PDF 的 `exp = 0`（`⼯作经历` 未命中章节规则），加 `NFKC` 后恢复为 1。

## 遗留

- 扫描版 PDF（纯图片）无文本层，当前直接判空，需 OCR 才能支持。
- 中英混排、双栏排版的简历字段归并仍有误差，建议人工核对预览再写入。
