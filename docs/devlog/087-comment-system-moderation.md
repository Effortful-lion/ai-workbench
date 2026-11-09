# 087 · 评论系统（树形模型 + 自动分流审核）

日期：2026-11-09 ｜ 分支：main ｜ 类型：feature

## 一、对三阶段方案的评估

| 阶段 | 方案内容 | 本项目结论 |
|---|---|---|
| 一 · MVP | root_id + parent_id + reply_to 冗余 + depth 压平；写入单次 INSERT | **采纳**。这是分页正确性与"回复 @某人"可渲染的地基 |
| 二 · 进阶 | Redis 分页缓存（comment:tree:{post}:page:{n}，TTL 300+random300）、只删前 3 页 | **不采纳**。SQLite 单机 + 个人规模，查询是本地文件级 O(pageSize)，加缓存只会引入一致性问题（审核状态变更要级联失效） |
| 三 · 最佳实践 | Kafka/RocketMQ 异步写、削峰 | **不采纳**。单进程无峰值；异步反而破坏"发完立刻看到自己评论"的确定性。若未来多实例，先把写接口换队列，模型无需改 |

**触发器**（什么时候才需要补二三阶段）：单篇评论 QPS > 50、一级评论翻页 P95 > 100ms、或部署多实例共享库时。

## 二、数据模型（已落地）

`blog_comments` 扩列：
- `root_id`：顶级评论自身 id；回复挂根
- `parent_id`：空串=顶级；回复=根评论 id（**超过 2 级压平到 1 级**）
- `reply_to_user_id / reply_to_username`：写时冗余，渲染不联表
- `depth`：0 / 1
- `status`：`pending | approved | rejected | hidden`
- `review_note / reviewed_at`：审核留痕

查询：一级分页（depth=0, approved, created_at desc）+ `root_id IN (...)` 批量子评论 + 内存组装，**无递归、无 N+1**。索引层面 SQLite 自动为 post_id 建索引足够当前规模。

## 三、审核机制设计（自研）

**原则：登录即身份，规则自动分流，人工只处理边缘。**

1. **身份**：发表必须登录，昵称=username，客户端不传身份（已在上轮实现）
2. **入口规则（硬拒绝）**
   - 内容 1–2000 字
   - 同用户同文章 10s 一条（限频）
   - 60s 内相同内容（去重）
3. **自动分流（软审核）**
   - 博主本人评论 → 直接 approved
   - 命中敏感词表（加微信/代开发票/博彩/赌场/贷款秒批/返利/刷单）→ pending
   - 正文链接 > 2 → pending
   - 连续 20+ 大写字母刷屏 → pending
   - 其余 → approved（先发后审的轻量策略）
4. **人工审核（博客面板 → 评论审核）**
   - 队列按状态筛选：待审 / 已通过 / 已拒绝 / 已隐藏
   - 动作：通过、拒绝（自动写备注「不符合评论规范」）、隐藏；支持恢复
   - 结论回告：通知评论者「通过 / 未通过」；回复场景通知被回复人
5. **通知闭环**
   - 待审 → 通知博主
   - 通过评论（非回复）→ 通知博主
   - 回复 → 通知被回复人（不打扰博主，除非是他自己）
   - 审核结论 → 通知评论者

## 四、前端

- 评论区（公开页）：两层树（一级 + 压平回复）、`回复 @某人`、楼层号、分页「加载更多」、待审提示「已提交，待作者审核后公开」、未登录显示「去登录」
- 博客面板：新增「评论审核」tab（待审计数徽标），文章 tab 保持只读
- 阅读页（面板内嵌）：只展示已通过评论
- **审核入口可发现性**（补）：公开页 `/b/:username` 由博主本人浏览时，列表页与阅读页评论区上方显示「N 条待审核 · 公开页不可见 / 去审核」，点击整页跳 `/?tab=moderation#/p=blog`；`BlogPanel` 读取 `?tab=` 落到审核 tab 并清理 search。原因是公开页按设计只返回 `approved`，博主在公开页看不到待审、也找不到按钮

## 五、验证

- 博主评论 → `approved`，`rootId==id`
- 读者普通评论 → `approved`；回复 → `depth=1, parentId==rootId, replyToUsername=admin`
- 敏感词评论 → `pending`；审核队列可见；通过后通知评论者（DB 校验 `blog|你的评论已通过审核`）
- 10s 内二次评论 → `发言过快，请稍后再试`
- 分页接口返回 `{threads,total,commentTotal,page,pageSize}`，无头渲染显示「评论 · N」与嵌套结构

**端到端实测（真实 HTTP，admin + tester 双账号连发 6 条）**

| 步骤 | 结果 |
|---|---|
| 博主一级评论 | `approved` `depth=0` `rootId==id` |
| 读者一级评论 | `approved` `depth=0` |
| 读者回复博主 | `approved` `depth=1` `parentId=root` `replyTo=admin` |
| 博主回复该回复（三级尝试） | **压平**为 `depth=1` `parentId=root` `replyTo=tester` |
| 读者再回复（四级尝试） | **仍压平**为 `depth=1` `parentId=root` `replyTo=admin` |
| 敏感词「加微信 代开发票」 | `pending`，公开页 `total` 不含它，审核队列可见，`PATCH approved` 后 `total+1` |

- 两层树渲染下 `admin` 楼层 `children=3`，`replyTo` 链 `tester→admin / admin→tester / tester→admin` 正确

## 六、复测：站内信出现「三四层」，公开页却只见两条

**现象**：站内信有 15 条 blog 通知（含「四级尝试」回复），公开页评论区只显示 2 条。

**排查结论**：

1. **通知不随评论删除**：`notifications` 与评论无级联关系，历史测试评论删了，通知仍在 → 站内信里的三四层是**上一轮残留**。已按 `type='blog'` 清空后复测。
2. **渲染没有漏**：干净重跑 5 条（2 一级 + A 楼层下 3 条回复），真实 HTTP 与浏览器截图一致，`回复 @admin / @tester` 全部正确。
3. **真问题是计数语义不一致**：文章头 `commentCount` 数全部 `approved`（含回复），评论区标题 `评论 · N` 用的却是 `total`（一级楼层数）→ 5 条只显示 2，造成「只看到两条」的错觉。

**修复**：

- `BlogCommentPageDto` 增 `commentTotal`（全部 `approved` 条数）；`total` 收窄语义为「一级楼层数」，仅用于分页
- `CommentThread` 标题改用 `commentTotal`，分页「加载更多」仍按 `total` 判断（否则回复数会让它误判还有下一页）
- `BlogPanel` 内存组装的 page 同步补 `commentTotal`

**复测结果（数据保留供验收）**：

| 位置 | 内容 | 结果 |
|---|---|---|
| 楼层 1 | tester「【一级B】」 | 无回复 |
| 楼层 2 | admin「【一级A】」 | 3 条回复 |
| 回复 | tester「【二级】」 | `depth=1` `replyTo=admin` |
| 回复 | admin「【三级尝试】」 | 压平 `depth=1` `replyTo=tester` |
| 回复 | tester「【四级尝试】」 | 压平 `depth=1` `replyTo=admin` |

接口：`total=2`（楼层）、`commentTotal=5`；页面标题显示「评论 · 5」，与文章头一致。

## 七、遗留

- 敏感词表/阈值目前是常量，后续可挪到设置
- 评论审核暂无「批量通过」「举报」入口
- 待审提醒只有公开页提示条 + 面板 tab 徽标，没有站内信/常驻角标；博主不主动进博客就发现不了待审
- 若开启多实例部署，再评估 Redis 分页缓存与写队列（模型无需改）
