# 084 · 博客子模块 V1 正式落地（内容生产复用 KB）

日期：2026-11-09 ｜ 分支：main ｜ 类型：feature

## 决策

博客收敛为**纯展示层**（文章 + 评论），不做编辑器/草稿箱/上传通道。唯一创作入口 = KB：
`书写/上传 → KB（本体+向量） → KB 面板「▤ 博客」一键发布 → blog_posts 展示副本 → 公开页 /b/:username/:slug + 评论`

发布时自动：slug（8 位短码）、摘要（首个非标题段落）、published 状态、kbDocId 回链。

## 落地清单

**shared**：`blog.ts` 类型集（BLOG_CATEGORIES=kb/agent/pipe/essay，状态 draft/published/archived）；roles 增 `blog:read/blog:write`（member 默认含）；notify 类型增 `blog`。

**server**：
- `db/schema.ts`：`blog_posts`（slug 唯一、tagsJson、kbDocId 回链、publishedAt）、`blog_comments`（一级评论、approved/hidden、游客仅昵称）
- `blog/` 模块：service（publishFromKb 读 KbService.readOriginal；patchPost 状态流转自动维护 publishedAt；公开读匿名；评论落库后 notify.create 通知作者）+ controller（管理路由带 JWT+权限守卫，public/* 匿名——照抄 toolbox 模式）
- `tools/blog.tools.ts`：`blog.search`（检索已发表）+ `blog.listPublished`，AI 不再有草稿工具（生产在 KB）
- notify.service normalizeType/digest 补 blog 类型；NotifyModule 导出 NotifyService

**web**：
- `BlogPanel`（面板注册四件套 + `/blog` 命令）：台账行列表（状态/标题/分类/评论数/日期）、发布/下架/删除、展开区正文预览 + 评论管理（隐藏/恢复/删除）
- `PublicBlogPage`（`/b/:username` 卡片墙 + `/b/:username/:slug` 阅读页）：图纸卡片（2px 上浮 + 裁切角标）、左侧目录 scrollspy、MarkdownText 正文、游客评论（昵称制）
- KbPanel：embedded 文档行增「▤ 博客」动作 → 分类/标签弹层 → `/blog/from-kb`

## E2E 验证（全部通过）

登录 admin → KB 摄取测试文档 → `POST /blog/from-kb`（slug=7823900a，摘要自动生成）→ 匿名公开列表/详情 → 游客评论 → 公开评论列表 → notifications 表落库 `blog|博客新评论：《博客发布联动测试》`。三包 build/tsc 通过，drizzle push 完成。

## 遗留

- 代码高亮（rehype-highlight）待补；公开页 SEO/meta 待做；评论过审制开关（当前默认即时可见）
- 测试数据留在 KB/博客中各一条（标题「博客发布联动测试」），可从 BlogPanel 删除
