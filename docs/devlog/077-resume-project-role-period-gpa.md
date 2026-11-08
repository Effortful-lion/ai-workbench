# 077 · 项目经历对齐工作经历结构 + 教育 GPA 字段

日期：2026-11-08
状态：已完成

## 项目经历：与工作经历同构

问题：项目卡片没有岗位位、没有时间位，「技术负责人」被当成正文要点。

修改：
- DTO 扩展：[resume.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/resume.ts) `ResumeProject` 增加 `role`（承担角色）与 `period`（起止时间），与 `ResumeExperience` 对齐
- 解析：[resume.parser.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/resume/resume.parser.ts) 项目条目中首个短角色词（`技术负责人` / `项目负责人` 等，命中 `ROLE_RE`）提取为 `role`；`buildEntries` 已识别的日期范围直接落 `period`
- 归一化：[resume.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/resume/resume.service.ts) 保留 role/period
- 渲染：[ResumeCard.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/resume/ResumeCard.tsx) 标题行 = `项目名 · role`，右侧时间，正文要点列表 —— 与工作经历完全同构
- 旧数据兼容：渲染层若 `role` 为空且首要点像角色词，自动提到标题行；描述中能识别到 `2023.09-2024.06` 这类范围时自动提到右侧时间位

注意：当前档案的 RaftKV 数据源里没有任何日期文本，所以时间段仍为空——**不是渲染问题，是原始简历没有写**。可在 JSON 里补 `"period": "2024.03 - 2024.06"`。

## 教育 GPA 保存后不显示

根因：`ResumeEducation` 没有 GPA 字段，`normalizeProfile` 会**白名单式丢弃未知键**，手写 JSON 里追加的 `gpa` 保存后即被抹掉；同时教育条目过滤要求 `school` 非空，只带 GPA 的条目会整条被丢。

修改：
- DTO 增加 `gpa: string`；归一化兼容 `gpa` / `GPA` / `score` 三种写法
- 教育过滤放宽为 `school || gpa || major || degree`
- 解析器从教育行/行尾提取 `GPA 3.11/5`，不再混进「专业」串
- 渲染为独立要点 `· GPA：3.11/5`

## 验证

- 临时写入 `education[0].gpa = "3.11/5"` → PUT `/resume/me` → 回读为 `"3.11/5"`，随后已还原原始档案
- shared / server build 通过；web tsc 零错误；服务端已重启

> 提示：编辑器保存前会按后端 schema 归一化，**未定义字段会被静默丢弃**。新增字段需同步 shared DTO + service 归一化。
