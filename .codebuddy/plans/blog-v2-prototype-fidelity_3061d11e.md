---
name: blog-v2-prototype-fidelity
overview: 按原型《blog.html》重做博客 UI（卡片墙列表 + 左目录阅读页 + 一层评论），把发布/下架/删除操作全部收拢到 KB 文档行并成对出现，博客面板降为纯只读；同时引入 lucide-react 并只在本轮替换博客相关图标（其余面板后续再改）。
design:
  architecture:
    framework: react
  styleKeywords:
    - 终端美学
    - 图纸卡片
    - 1px 细线秩序
    - 克制动效
    - 单点强调色
  fontSystem:
    fontFamily: JetBrains Mono, MiSans
    heading:
      size: 24px
      weight: 600
    subheading:
      size: 15px
      weight: 500
    body:
      size: 15px
      weight: 400
  colorSystem:
    primary:
      - "#00E59B"
      - "#9A6200"
    background:
      - "#0B0D10"
      - "#12151A"
      - "#181C22"
      - "#F4EFE4"
    text:
      - "#E6E9EC"
      - "#C2C8CF"
      - "#8A919A"
      - "#4A5158"
    functional:
      - "#23282F"
      - "#2E3942"
      - "#FFB000"
      - "#FF5F56"
todos:
  - id: shared-server-contract
    content: 扩展 shared/blog.ts 与 blog 服务端：charCount、prev/next、kb-links 批量查询、发布幂等 upsert
    status: completed
  - id: icons-and-utils
    content: 安装 lucide-react，新建 lib/icons.tsx 图标注册表与 features/blog/blogUtils.ts
    status: completed
    dependencies:
      - shared-server-contract
  - id: blog-presentational
    content: 实现 BlogMarkdown、BlogCardWall、BlogReader、CommentThread 四个可复用展示组件
    status: completed
    dependencies:
      - icons-and-utils
  - id: public-page-rewrite
    content: 重写 PublicBlogPage：卡片墙 + FLIP 阅读 + History 路由 + 评论提交
    status: completed
    dependencies:
      - blog-presentational
  - id: panel-readonly
    content: 重写 BlogPanel 为只读：列表 + 内嵌阅读 + 评论线程，移除全部写操作
    status: completed
    dependencies:
      - blog-presentational
  - id: kb-publish-cluster
    content: 改造 KbPanel 文档行：发布/下架/上架/移除状态化按钮组与图标，复用发布弹层
    status: completed
    dependencies:
      - shared-server-contract
      - icons-and-utils
  - id: verify-and-doc
    content: 跑 tsc/构建/API 链路与界面走查，补 devlog 并提交
    status: completed
    dependencies:
      - public-page-rewrite
      - panel-readonly
      - kb-publish-cluster
---

## 需求概述

博客子模块 v2：**UI 完全对齐已确认原型 `docs/prototype/blog.html`**，交互补齐评论；**所有写操作（发布/下架/重新上架/移除）成对收拢到 KB 文档行**，博客侧降为纯只读；同时引入统一图标体系并**只在本轮替换博客相关图标**。

## 核心功能

### 1. 公开页（游客可读，`/b/:username`、`/b/:username/:slug`）

- **卡片墙**：响应式网格；每卡 = 编号 + 分类 + 标题两行 + 摘要两行 + 底行（日期 / 字数刻度 / 评论数）；1px 实线、方角、方格纸底纹；悬停仅 2px 上浮 + 两处裁切角标点亮，鼠标离开复位。
- **分类导航词**：`#全部 #知识库 #Agent #管道 #随笔`，点谁谁留下，计数实时更新。
- **排序**：`最新 / 最早 / 最长` 单键循环。
- **阅读页**：点卡片原位铺满全屏（FLIP），地址栏变为 `/b/u/slug`，浏览器返回可退出；左侧 sticky 目录随滚动高亮、点击平滑跳转；680px 版心、15px/2.05 行距、二级标题带点缀色左边线；顶部返回 + 路径 + 字数/预计分钟；页尾上下篇。
- **评论**：一层、游客昵称制、即时可见；方块首字头像 + 昵称 + 楼层号 + 时间 + 内容 + 表单（昵称 / 正文 / 发布）。

### 2. 博客面板（只读）

- 文章列表（状态标记、分类、评论数、日期）+ 点开阅读（同款阅读页）+ 评论线程纯展示；**面板内不出现任何发布/下架/删除/审核按钮**；顶部提示“内容在 KB 中书写与发布”，可一键跳转 KB。

### 3. KB 文档行（唯一写操作入口）

- 同一位置成对显示状态化操作：
- 未发布 → `发布到博客`（点开选分类/标签，slug 与摘要自动生成）
- 已发布 → `下架` + `移除`
- 已下架 → `重新上架` + `移除`
- 操作成功后 KB 行状态即时刷新，并给出公开地址提示。

### 4. 图标现代化（本轮范围）

- 引入统一线性图标体系，博客与 KB 发布相关按钮使用语义化图标（发布=纸飞机、下架=归档盒、上架=回旋箭头、移除=垃圾桶、阅读=书本、评论=对话气泡、目录/返回/翻篇=方向箭头），描边 1.5px、尺寸 12–16px，颜色继承终端 token。
- 建立可扩展图标注册表，其余 18 个面板本轮不动，后续按同一套表逐步替换。

### 5. 视觉基调

延续工作台终端美学：`#00E59B` 单一强调色、1px 细线、方角、等宽字体、暗/暖双主题；动效克制，仅保留上浮 2px、角标点亮、阅读页 450ms 铺开。

## 技术栈

- 前端：React 19 + TypeScript + Tailwind CSS v4（`@theme inline` 语义 token：`bg/bg1/bg2/line/acc/tx/tx2/tx3`）
- Markdown：现有 `react-markdown` + `remark-gfm` + `remark-breaks`；博客阅读页新增独立渲染组件（不改全局 `MarkdownText`，避免影响聊天消息观感）
- 图标：新增 `lucide-react`（tree-shake，SVG 线性）
- 服务端：NestJS + drizzle + SQLite（表已存在，无需迁移）
- 路由：真实 pathname（`/b/:username(/:slug)`），列表 ↔ 阅读用 History API 在同一 React 树内切换，保持 FLIP 不整页刷新

## 实现方案

### 1. 共享类型（`packages/shared/src/blog.ts`）

- `BlogPublicPostDto` 增 `charCount`（字数刻度与“最长”排序依据，避免为排序拉全文）
- `BlogPublicPostDetailDto` 增 `prev/next: { slug, title } | null`（服务端按 publishedAt 顺序计算，免除额外请求）
- 新增 `BlogKbLinkDto { kbDocId, postId, slug, status, title }`：KB 行状态的数据源

### 2. 服务端（`apps/server/src/blog/`）

- `publishFromKb` 改为**幂等 upsert**：按 `(ownerId, kbDocId)` 查找——无则创建 published；已 archived 则刷新正文/摘要/标题并重新上架；已 published 返回 409 语义错误“已在博客中”。同文档点击多次不会产生重复文章（现有唯一约束只有 slug，重复发布会产生副本，必须收口）。
- 新增 `listKbLinks(userId)`：一次查出该用户全部 `kbDocId → 文章状态`，供 KB 文档列表批量标注（避免逐行 N+1）。
- 新增路由 `GET /blog/kb-links`（`blog:read`）。
- `publicList` 附带 `charCount`；`publicPost` 计算 prev/next。
- 保留既有：公开读匿名、评论落库 + notify 通知作者、状态流转维护 publishedAt。

### 3. 前端结构（新增可复用展示组件，公开页与面板共用）

```
apps/web/src/
├── lib/icons.tsx                     # Icon 注册表（name → lucide 组件，统一 14px/1.5 描边）
└── features/blog/
    ├── blogUtils.ts                  # 分类元数据/日期/字数/阅读时长/排序/标题切段与锚点
    ├── BlogMarkdown.tsx              # 阅读版心渲染（h2 24px、h3 带左线、p15px/2.05、代码块/引用/表格）
    ├── BlogCardWall.tsx              # 卡片墙 + 分类词 + 排序键（props 注入 posts/onOpen）
    ├── BlogReader.tsx                # 阅读页：顶栏/左目录 scrollspy/版心/上下篇/评论槽位
    ├── CommentThread.tsx             # 一层评论列表（readOnly 可关表单）
    ├── PublicBlogPage.tsx            # 列表 ↔ FLIP 阅读 + History 路由 + 评论提交
    └── BlogPanel.tsx                 # 只读面板：列表 + 内嵌阅读 + 评论线程
```

- 分类/排序/字数/评论数逻辑集中在 `blogUtils.ts`，两个视图不重复实现（DRY）。
- `BlogReader` 通过 `mode: "page" | "embedded"` 适配公开页全屏与面板内嵌，目录 scrollspy 以滚动容器的 ref 为根。
- 面板与公开页共用 `BlogCardWall`，仅 `onOpen` 行为不同（一个切内部状态、一个 pushState）。

### 4. FLIP 与路由（公开页）

- 卡片 `getBoundingClientRect()` 作为首帧，fixed 覆盖层以 top/left/width/height 过渡到 `inset:0`（450ms，`cubic-bezier(.2,.8,.2,1)`）。
- 打开时 `history.pushState(null, "", "/b/u/slug")`；`popstate` 回列表；返回按钮/上下篇走同一套内部导航，避免整页刷新丢状态。

### 5. KB 文档行改造（`features/kb/KbPanel.tsx`）

- 挂载时与 `reload()` 同步拉取 `/blog/kb-links`，构建 `Map<kbDocId, link>`。
- 文档行 actions 区渲染状态化按钮组（图标 + 文案），点击后局部更新该 Map，不整表刷新。
- 发布弹层复用现有分类/标签表单，确认后走同一 `/blog/from-kb`，成功提示公开地址。
- 下架/上架/移除复用 `PATCH /blog/posts/:id`、`DELETE /blog/posts/:id`，移除走 `useConfirmStore` 二次确认（提示评论一并删除、KB 文档不受影响）。

### 6. 图标体系

- `lib/icons.tsx`：`IconName` 联合类型 + `ICONS` 常量表 + `<Icon name size stroke className />`，默认 14px / 1.5 描边 / `currentColor`。
- 本轮只新增博客所需条目，后续图标大整改在同一文件扩展即可，不需要逐文件改引入方式。

## 实施要点

- **性能**：卡片墙纯展示，排序/分类在内存完成（O(n log n) / O(n)）；KB 状态一次批量查询；阅读页目录只解析标题行，不做全文扫描；scrollspy 用滚动监听 + `requestAnimationFrame` 节流，避免每帧重排。
- **回归控制**：不改 `MarkdownText`（聊天依赖）；不改 `App.tsx` 路由结构；公开 API 路径与权限点保持不变；`publishFromKb` 语义收口后需回归“重复发布”路径。
- **数据一致性**：KB 文档删除后，博客文章保留但 kbDocId 指向不存在的文档——KB 列表自然不再展示其状态，公开页不受影响；在 devlog 记录该约定。
- **可访问性/交互**：卡片支持 Enter 打开；阅读页 Esc 返回；目录锚点 `scroll-mt` 抵消固定顶栏。
- **验证**：`tsc` + 两包 build；API 链路验证（登录 → 发布 → 重复发布报错 → 下架 → 公开页 404 → 上架 → 评论 → 通知）；浏览器走查列表/阅读/评论/面板只读/KB 状态切换。

## 目录与文件清单

```
packages/shared/src/blog.ts                     # [MODIFY] charCount、prev/next、BlogKbLinkDto
apps/server/src/blog/blog.service.ts            # [MODIFY] publish upsert、listKbLinks、公开列表/详情扩展
apps/server/src/blog/blog.controller.ts         # [MODIFY] GET /blog/kb-links
apps/web/package.json                           # [MODIFY] 新增 lucide-react
apps/web/src/lib/icons.tsx                      # [NEW] 图标注册表与 Icon 组件
apps/web/src/features/blog/blogUtils.ts         # [NEW] 分类/日期/字数/排序/目录解析
apps/web/src/features/blog/BlogMarkdown.tsx     # [NEW] 阅读版心 Markdown 渲染
apps/web/src/features/blog/BlogCardWall.tsx     # [NEW] 卡片墙 + 分类 + 排序
apps/web/src/features/blog/BlogReader.tsx       # [NEW] 阅读页（目录/版心/上下篇/评论槽）
apps/web/src/features/blog/CommentThread.tsx    # [NEW] 一层评论列表
apps/web/src/features/blog/PublicBlogPage.tsx   # [MODIFY] 重写：FLIP + History 路由 + 表单
apps/web/src/features/blog/BlogPanel.tsx        # [MODIFY] 重写：只读面板
apps/web/src/features/kb/KbPanel.tsx            # [MODIFY] 发布/下架/上架/移除 状态化按钮组 + 图标
docs/devlog/085-blog-v2-prototype-fidelity.md   # [NEW] 变更与约定记录
```

## 设计方向

严格复刻已确认原型：**终端图纸美学 + 克制动效**。列表是“一墙裁切好的图纸卡片”，阅读是“一张图纸铺满工作台”。

## 视觉规则

- 卡片：`bg-bg1` 底、1px `line` 边框、0 圆角、无投影；间距 14px，列宽 `minmax(270px,1fr)`，窄屏 240px。
- 悬停：整体上浮 2px、边框过渡到 `acc/33`、底色转 `bg2`；左上/右下两处 9px 裁切角标延伸至 16px 并点亮为强调色；字数刻度条点亮。鼠标离开立即复位，无位移残留。
- 阅读页：全屏铺开 450ms；顶栏 50px 1px 下边框；左目录 190px、`acc` 左边线高亮当前小节；版心 680px；标题下 meta 行（标签 / 日期 / 约 N 字 · N 分钟）；`##` 标题左缘 2px 强调色竖线。
- 评论：首字方块头像（`acc` 文字 + `acc/8` 底）、昵称与时间等宽小字、楼层号右对齐、虚线分隔；表单为虚线框。
- 图标：1.5px 描边线性图标，与文字基线对齐，颜色继承 `tx3`，悬停转 `acc`；不使用彩色填充图标。

## 响应式

- ≤1020px：目录从左侧移到正文上方双栏排布；上下篇与评论同宽。
- ≤900px：卡片列宽降为 240px，计数与排序键可隐藏，标题不做截断策略变化。
- 卡片与阅读页均可键盘操作（Enter 打开、Esc 返回）。

## Agent Extensions

### Skill

- **verification-before-completion**
- Purpose: 在宣称完成前强制跑通类型检查、构建与 API 链路验证
- Expected outcome: 输出可复现的验证证据（tsc/build/E2E 结果），避免未验证即交付

### Skill

- **code-review-myself**
- Purpose: 按用户个人代码规范复核本轮 diff（保守抽象、分层清晰、无兼容层）
- Expected outcome: 给出逐文件问题清单并在提交前修复

### SubAgent

- **code-explorer**
- Purpose: 执行阶段快速定位 KB 文档行、面板注册、主题 token 等改动点
- Expected outcome: 精确的文件与行号定位，减少无效读取