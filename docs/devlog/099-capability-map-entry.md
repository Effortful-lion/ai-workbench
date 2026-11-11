# 099 · 能力地图补齐博客/跨域检索入口

日期：2026-11-10 ｜ 分支：main ｜ 类型：fix

## 一、现象

问「网站支持哪些」时，`site.capabilities` 返回的模块表里：

- 博客（blog）：入口显示 `—`
- 跨域检索（search）：入口显示 `—`

模型据此回答「博客没有入口」，而实际面板路径是 `~/blog`（公开阅读页 `/b/:username/:slug`）。

## 二、原因

`apps/server/src/tools/site.tools.ts` 的 `MODULE_META` 是「模块 → 标题 / 面板 / 入口 / 职责」的静态表，`buildCapabilityModules()` 用工具名前缀（`blog.list` → `blog`）反查它。博客与跨域检索这两个命名空间的工具一直存在（`blog.tools.ts`、`search.tools.ts`），但表里没有对应条目，于是走了兜底：

```ts
const meta = MODULE_META[id] ?? { title: id, panel: null, entry: `访达 ${id} 相关接口`, summary: "" };
```

`panel: null` + 兜底文案 → 前端表格渲染不出入口，模型也读不懂。

## 三、修复

1. `MODULE_META` 补两条：

```ts
search: { title: "跨域检索", panel: null, entry: "由 AI 直接调用，无需打开面板",
          summary: "同时搜索网页、GitHub 与本地知识库并去重" },
blog:   { title: "博客", panel: "blog",
          entry: "/blog（面板内文章列表；公开阅读页 /b/:username/:slug）",
          summary: "已发布文章的列表与全文检索、文章编辑与评论审核；访客可在公开页评论" },
```

2. 兜底文案从 `访达 xxx 相关接口` 改成「由 AI 直接调用，无需打开面板」+「（xxx 模块暂未登记说明）」。这样以后新加工具命名空间时，即使忘了登记元信息，能力地图也不会出现空入口（只是说明缺一段职责）。

## 四、影响面

`MODULE_META` 同时驱动三处，改一处三处生效：

- `buildCapabilityModules()` → `site.capabilities` 工具返回（本轮问题点）
- `capabilityGuide()` → 注入 system prompt 的能力地图
- `moduleDigest()` → 意图路由的模块清单（现在 router 才能把博客类问题路由到 blog）

`buildCapabilityDocs()` 只输出有操作目录的模块，博客目前没有 `BLOG_OPERATIONS`，所以不会生成博客能力手册（不影响本轮；后续若要「博客怎么用」类问答更准，可把它补进操作目录）。

## 五、验证

`pnpm --filter @aiwb/server build` 通过。用编译产物直接跑聚合函数：

```
search → 由 AI 直接调用，无需打开面板
kb     → /kb（先上传文档，右侧问答页提问）
blog   → /blog（面板内文章列表；公开阅读页 /b/:username/:slug）
```

## 六、遗留

- 博客仍只有 2 个手写工具（`blog.list` / `blog.*`），接口侧的 `BLOG_OPERATIONS` 未登记，所以能力手册里没有博客一篇，`findOperation("blog.list")` 也拿不到 summary，只能退回工具描述。
- 新增模块时仍要记得在 `MODULE_META` 里加一条；建议后续加一个单测把「工具命名空间 ⊆ MODULE_META keys」钉住。
