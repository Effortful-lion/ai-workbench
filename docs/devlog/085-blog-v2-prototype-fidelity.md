# 085 · 博客 V2：对齐原型、写操作收拢 KB、图标体系起步

日期：2026-11-09 ｜ 分支：main ｜ 类型：feature / refactor

## 本轮用户要求

1. UI 按已确认原型 `docs/prototype/blog.html` 重做（当前实现不符合）
2. 评论必须真实存在（此前看不到评论交互）
3. 发布/下架必须成对，且全部放 KB；博客面板只读（后续要开放给他人读权限）
4. 图标现代化——一个大整改，本轮先从博客做起，其余面板等通知

## 实现

### 服务端（契约收口）

- `publishFromKb` 改**幂等 upsert**：按 `(ownerId, kbDocId)` 收口，同一 KB 文档永远只对应一篇博客；
  已 published 重复发布返回「请先下架再重新发布」，已 archived 则刷新正文/标题/摘要并重新上架。
- 新增 `GET /blog/kb-links`：一次返回 `kbDocId → { postId, slug, status }`，KB 文档行按钮组据此渲染（无 N+1）。
- 公开列表补 `charCount`（卡片字数刻度 /「最长」排序依据）；公开详情补 `prev/next`（按 publishedAt 序）。
- 公开路由不再包一层 `BadRequestException`：下架文章访问返回 404 而非 400。

### 前端（展示层重建）

- `lib/icons.tsx`：lucide-react 统一图标注册表（`<Icon name />`，1.5px 描边 / 14px / currentColor）。
  本轮条目：publish/archive/restore/trash/blog/comment/back/prev/next/toc/preview/newspaper/write/doc/external/sort/clock/tag。
- `features/blog/blogUtils.ts`：分类/排序/日期/字数刻度/阅读时长/目录切段（`splitSections` 与 `parseHeadings` 共用锚点 id）。
- 展示组件：`BlogCardWall`（卡片墙 + 分类导航词 + 排序，悬停仅 2px 上浮 + 裁切角标点亮）、
  `BlogReader`（顶栏 / 左目录 scrollspy / 680px 版心 / 上下篇 / 评论槽）、`CommentThread`（一层、游客昵称、
  即时可见、只读开关）、`BlogMarkdown`（独立阅读版心渲染，不改聊天用 `MarkdownText`）。
- `PublicBlogPage`：卡片墙 ↔ FLIP 全屏阅读（450ms，从被点卡片长出来）+ History 路由（pushState/popstate/Esc）。
- `BlogPanel`：**只读**——卡片墙 + 内嵌阅读 + 评论线程；写操作按钮全部移除，顶部「去知识库」引导。
- `KbPanel`：文档行新增状态化博客动作组（同位置成对出现）：
  未发布 → `发布`；已发布 → `下架` + `移除`；已下架 → `重新上架` + `移除`；
  行元信息展示 `▤ 已发布 / 已下架` 徽标；发布弹层与确认按钮换成语义图标。
- `PanelZone`：`PANEL_META.icon`（本轮仅 blog 使用 `newspaper`），其余面板暂留原符号。

## 验证

- `tsc --noEmit`（web/server/shared）、`pnpm build`（web/server）全绿。
- API 链路：kb-links 正常；重复发布被拒（400 文案正确）；下架后公开详情 404、重新上架 200；
  公开详情返回 `charCount` 与 `prev/next`。
- 无头 Chrome 渲染真实页面：`/b/admin` 出现卡片（#001/#002、分类词、标题）；`/b/admin/7823900a` 出现目录（sec-0/sec-1）、
  上下篇、评论数 1、评论表单。

## 约定

- KB 文档删除后博客文章保留（kbDocId 悬空）：KB 列表不再展示其状态，公开页不受影响。
- 草稿/已下架文章仅在博客面板可见可读，公开页不可见。
- 评论为一层游客昵称制、即时可见；嵌套/审核/点赞等完整设计后续单独提供。

## 遗留

- 其余 18 个面板的图标替换（同一 `lib/icons.tsx` 扩展，等通知）
- 评论审核与完整评论设计、代码高亮、公开页 SEO meta
