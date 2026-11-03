# 038 · 简历档案卡改版：终端风 → 文档式排版

- 日期：2026-11-04
- 状态：已完成

## 目标

终端档案卡（whoami / ls ./experience / cat skills.json）读者不直观：① 排版要一眼看清结构；② 去掉 `admin@wb:~$` 等命令装饰，只留标题 + 内容；③ 源文件排版再乱，页面也要呈现正确布局。

验收：简历页无终端元素，分区标题清晰（工作经历/项目经历/教育经历/专业技能），凌乱旧数据渲染不碎。

## 决策

- **纯文档卡替代终端卡**：删除命令行交互（help/all/clear/edit 命令）、窗口红绿灯、命令输入框；折叠交互也一并去掉——信息一屏读完比点击展开更直接。
- **结构即排版**：分区 = 卡片内 `border-t` 分隔的 section，条目 = 「公司/学校/项目名 + 右侧等宽日期」头行 + 要点列表；技能改 chips，比 JSON 字面量更像给人看的简历。
- **凌乱数据渲染层兜底**：解析（037）修不掉库里已存的旧脏数据，渲染层统一 `clean()` 收空白、要点按「；」拆行、skills 去重、空分区整体不渲染。
- **组件更名**：`ResumeTerminal.tsx` → `ResumeCard.tsx`，去掉 `path` / `onEdit` props（编辑入口本就在面板右上角）。

## 实现

- `apps/web/src/features/resume/ResumeCard.tsx`（新增，替换 ResumeTerminal）：header（姓名/头衔/联系/简介）+ 四个按需渲染的 section；正文用 `font-sans`，日期/标签保留 `font-mono` 点缀，沿用全站 token（acc/tx2/line）。
- `ResumePanel.tsx`：换用 ResumeCard；导入面板、JSON 编辑面板的 `admin@wb:~$` 装饰头改为中文标题；页头 `~/me ·` 路径去掉。
- `PublicResumePage.tsx`：换用 ResumeCard；404 错误框去掉红绿灯窗口装饰。

## 验证

- `pnpm --filter @aiwb/web build` 通过。
- 浏览器访问 `/p/admin`：四个中文分区标题齐全、无任何 `admin@wb:~$`/命令文本、姓名+头衔在卡片顶部，截图检查 PASS（含旧脏数据「；」拼接要点的拆行渲染）。

## 遗留

- 命令行导航能力随终端卡一并移除（help/all/clear/edit）；分区不多，暂无替代导航。
- 编辑/导入面板内部仍是 `font-mono` 工具风，仅去掉了提示符装饰，未改版式。
