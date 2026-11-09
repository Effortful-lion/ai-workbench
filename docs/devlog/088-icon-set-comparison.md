# 088 · 全站图标选型对比页（3 套线型库 × 65 语义）

日期：2026-11-09 ｜ 分支：main ｜ 类型：prototype

## 一、背景

`apps/web/src/lib/icons.tsx` 目前只有 17 个语义名（博客 + KB 发布动作），其余面板入口、通用操作、状态反馈全站都没有图标。整体换库之前，先用一个纯图标页对比：「同一语义，不同笔画」。

## 二、产出

`docs/prototype/icons.html`（单文件，无构建）

**3 套候选**：Lucide（现状基线）、Tabler、Remix。

初版曾加入 Phosphor、Iconoir，按需求移除：Phosphor 端点圆润、与终端/图纸语气冲突；Iconoir 在 14px 下笔画过细，warm 纸面主题（`#9A6200` 强调色）上对比度不足。

**65 个语义，分 5 组**：

| 组 | 数量 | 内容 |
|---|---|---|
| NAV · 导航 | 18 | 模型管理 / AI 助手 / 执行历史 / 访问统计 / 知识库 / 博客 / 项目管理 / 代码 / 日程 / 邮件 / 站内信 / 商业化 / 客户 / 流水线 / 简历 / 百宝箱 / 工具管理 / GitHub |
| ACT · 操作 | 23 | 发布、下架、上架、删除、编辑、预览、外链、排序、筛选、搜索、刷新、上传、下载、复制、保存、新建、关闭、展开、全屏、设置、退出、用户、权限 |
| STATE · 状态 | 5 | 成功、警告、失败、提示、加载中 |
| CONTENT · 内容 | 14 | 文档、文件夹、标签、时间、评论、回复、点赞、收藏、分享、链接、图片、附件、表格、代码块 |
| READ · 阅读 | 5 | 目录、返回、上一篇、下一篇、博客面板 |

页面能力：`dark/warm` 双主题切换、`14/22/32` 三档尺寸（14 是真实使用尺寸）、缺失自动标红。

## 三、类名校验

批量抓取三套库的 CSS/UMD 逐条比对（195 格）：

| 库 | 结果 |
|---|---|
| Lucide | 65/65（需把 kebab-case 转 PascalCase 再查 UMD 导出，直接查 kebab 会全军覆没） |
| Tabler | 65/65。`ti-newspaper` 不存在 → `ti-news` |
| Remix | 65/65。`ri-trello-board-line` 不存在 → `ri-kanban-view` |

修正后：**195 格映射，缺失 0**。

## 四、踩坑

1. **Tabler 必须有 `ti` 基础类**：只写 `class="ti-box"` 时 `::before` 的 content 存在，但 `font-family` 没挂上，字体 `status=unloaded`，整列渲染成方块（tofu）。而「检测 `::before` content 是否存在」的审计**查不出这种情况** —— 补了 `document.fonts.check('16px "tabler-icons"')` 才暴露。这类缺字比映射写错更隐蔽。
2. **首行图标整行不显示**：`.wrap { overflow-x: auto }` 把 `thead th { position: sticky }` 的吸附基准换成了滚动容器，表头压住第一行。对比表一屏内放得下，去掉 sticky。
3. **截图验证的 clip 不能超出视口**：分段截图前先 `setViewportSize` 撑高，否则后续片段静默不生成。

## 五、初判（未改业务代码）

- **Tabler**：2px 方头，同为 24 网格但笔画比 Lucide 粗一档，面板入口这种小尺寸下更「实」，与图纸网格底纹最搭
- **Remix**：1px 最细，14px 下细节开始糊，warm 主题风险最高；但它的 `chat-3`、`kanban-view`、`code-box` 语义更贴业务
- **Lucide**：现状，圆头最中性，语义命名最规范（`square-kanban`、`code-xml` 都有）

## 六、选型结论（已定）

**维持 Lucide，不迁移。**

对比后的判断：Lucide 在 14px 真实尺寸下笔画最稳，语义命名最规范（`square-kanban`、`code-xml`、`square-code` 这些偏业务的语义都有现成对应），且 `icons.tsx` 的 `ICONS` 注册表已经是全站统一的入口 —— 换库只能换来笔画风格，换不来结构收益，却要承担 65 个语义逐个复核的成本。

因此业务代码零改动：
- `apps/web/src/lib/icons.tsx` 保持 lucide-react，1.5px 描边、默认 14px、`currentColor`
- 面板入口暂不加图标（`PANEL_META` 里只有 blog 配了 `newspaper`），需要时按语义直接往 `ICONS` 里补，调用点无需改

`docs/prototype/icons.html` 保留为**查表工具**：将来给某个模块补图标时，打开它对照 Lucide 列挑名字即可，不再作为待定事项。
