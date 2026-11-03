# 013 · commerce 商业化管理

- 日期：2026-11-02
- 状态：✅ 完成（接口权限矩阵 / seed 幂等 / 浏览器三角色验证全部 PASS）

## 目标

按总体设计三期第一个模块「商业化管理」落地项目商业化事项：

- `~/biz` 终端式营收看板：KPI 条、订阅方案、支付流水、广告位四个视图。
- 订阅方案：价格 / 周期 / 订阅人数 / 状态，推导 MRR。
- 支付流水：客户、商品、金额、渠道、待支付 / 已支付 / 已退款状态流转。
- 广告位：预算 / 消耗与计划 / 在线 / 暂停 / 结束状态切换。
- owner 独占：member / guest 面板 403，服务端权限与 AI Tool 同步过滤。
- 注册 AI Tool：概览、方案、订单、广告位与演示数据。
- 本期不接真实支付网关 / 广告平台，只做本地记账与运营看板。

## 决策

1. **一期本地记账，不接真实支付**：没有支付宝 / 微信下单、回调、对账与退款 API；`commerce_orders` 只记录「这笔钱是否到账」，为后续接入预留 `channel` 与状态字段。
2. **MRR 由「价格 × 订阅人数」推导**：订阅人数是运营手动维护值，不要求每笔订阅都生成订单；月付按原价计入，年付按 12 个月摊平。避免为了看板 MRR 伪造几十笔订单。
3. **订单状态三态**：`pending` → `paid` → `refunded`；支付只对 pending 生效，退款只对 paid 生效，重复退款返回 400。已退款订单保留 `paidAt` 供历史追溯。
4. **广告位状态机四态**：`planned` → `active` ⇄ `paused` → `ended`；上线时补 `startedAt`，结束时补 `endedAt`，不自动改写历史时间。
5. **金额按整数元存储**：一期价格为 ¥29 / ¥99 / ¥399 这类整数，直接 `integer` 落库，避免 SQLite `real` 的浮点误差；如后续需要分币精度，统一迁移为「分」。
6. **项目关联可选**：`projectId` 允许为空，商业化记录可以是独立收入 / 广告；关联项目时校验归属，项目删除级联清理商业化记录。
7. **owner-only**：原型 ACL 为 `~/biz owner rw / member × / guest ×`。member 权限列表不授予 `commerce:*`，服务端 `PermissionGuard` 与 Tool Registry 都按同一套权限过滤。
8. **演示数据幂等**：`commerce.seed` 只在用户完全没有任何方案 / 订单 / 广告时写入固定样本，重复执行返回 `seeded:false`，避免污染真实账本。
9. **面板沿用终端范式**：KPI 用等宽小卡、列表用 `▸` / `//` 行式表格、命令栏承担所有写操作，不引入传统表单卡片与下拉表单。

## 实现

- 共享协议：[commerce.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/commerce.ts)
  （周期 / 方案状态 / 订单状态 / 支付渠道 / 广告状态与渠道枚举，
  `CommercePlanDto`、`CommerceOrderDto`、`CommerceAdDto`、`CommerceDigestDto`、`CommerceSeedResult`），
  由 [index.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/index.ts) 导出。
- 表结构：[schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts)
  新增 `commerce_plans`（`id/owner_id/project_id/name/price/cycle/status/subscribers/created_at`）、
  `commerce_orders`（`id/owner_id/project_id/plan_id/customer_name/item/amount/channel/status/paid_at/created_at`）、
  `commerce_ads`（`id/owner_id/project_id/name/channel/budget/spend/status/started_at/ended_at/created_at`），
  用户级联删除、方案删除后订单 `plan_id` 置空；已 `drizzle-kit push --force`。
- 服务端：
  - [commerce.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/commerce/commerce.service.ts)
    方案 / 订单 / 广告位 CRUD，`payOrder` / `refundOrder`，`digest()`（MRR、累计与本月支付、退款、广告消耗、净收入），
    `findOrderByKey` / `findAdByKey` 供命令栏与 AI Tool 按 id / 关键词定位，`seed()` 幂等写入演示数据。
  - [commerce.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/commerce/commerce.controller.ts)
    `GET /api/commerce/digest`、`POST /api/commerce/seed`、
    `GET/POST /api/commerce/plans`、`PATCH/DELETE /api/commerce/plans/:id`、
    `GET/POST /api/commerce/orders`、`POST /api/commerce/orders/:id/pay|refund`、`DELETE /api/commerce/orders/:id`、
    `GET/POST /api/commerce/ads`、`PATCH/DELETE /api/commerce/ads/:id`；
    全部由 `JwtAuthGuard + PermissionGuard` 保护，读用 `commerce:read`、写用 `commerce:write`。
  - [commerce.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/commerce/commerce.tools.ts)
    `commerce.digest` / `commerce.plan.list` / `commerce.plan.create` /
    `commerce.order.list` / `commerce.order.create` / `commerce.order.pay` / `commerce.order.refund` /
    `commerce.ad.list` / `commerce.ad.create` / `commerce.ad.status` / `commerce.seed`。
  - [commerce.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/commerce/commerce.module.ts)
    接入 [app.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/app.module.ts)。
- 前端：
  - [CommercePanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/commerce/CommercePanel.tsx)
    `~/biz/revenue.dashboard` 标题栏 / 摘要条 / KPI（MRR、支付成功、广告消耗、净收入）/
    总览（订阅计划 + 最近支付流水 + 广告位）/ 订单（状态过滤 + grep + 支付退款）/
    订阅方案（上架停售）/ 广告位（上线暂停结束）/ 命令栏
    （`biz.seed`、`biz.order.new`、`biz.plan.new`、`biz.ad.new`、`biz.order.pay/refund`、`biz.plan.archive/activate`、`biz.ad.activate/pause/end`）。
  - [panel.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/panel.ts) 注册
    `biz`（`商业化管理` / `~/biz`）；
    [PanelZone.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/PanelZone.tsx) 映射
    `biz: () => <CommercePanel />`；
    [HeroState.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/HeroState.tsx) 新增
    「▸ 打开商业化管理」chip。CommandPalette / CliOverlay / StatusBar 由 `PANEL_META` 自动派生入口。

## 验证

- 构建：shared `tsc` 通过；server / web `tsc --noEmit` 0 错误；web `vite build` 通过（79 modules）。
- curl（owner / member 签发 JWT，guest 用 role=guest token，端口 8700）：
  - `GET /commerce/digest`：未登录 401 · guest 403 · member 403 · owner 200。
  - `POST /commerce/seed`：guest 403 · member 403；owner 首次 `{seeded:true,plans:3,orders:7,ads:3}`，
    再次 `{seeded:false}`，幂等成立。
  - seed 后 owner digest：`mrr:4174`、`subscribers:86`、`revenue:655`、`monthRevenue:29`、
    `refunded:29`、`paid:5`、`pending:1`、`adSpend:1030`、`adBudget:2800`、`net:-404`。
  - owner 新建方案（price 19 / subscribers 3 → MRR ¥57）、新建订单（默认 pending）→
    `POST /orders/:id/pay` 201 → 再次 `POST /orders/:id/refund` 201 →
    第三次退款返回 `400 只有已支付订单可退款`。
  - owner 新建广告位 `planned` → `PATCH {status:"active"}` 200；member `GET /commerce/plans` 403，
    `PATCH` owner 方案 id 亦 403；测试记录已全部 DELETE 清理。
  - `GET /tools`：owner 可见 11 个 `commerce.*` 工具；member / guest 均无。
- 浏览器（headless Chrome + CDP，注入 `localStorage['aiwb-auth']`）：
  1. owner 点击「▸ 打开商业化管理」→ 标题 `~/biz/revenue.dashboard — 2026-11`、摘要 MRR、
     KPI 四格、pro/team/lifetime 方案、陈静等待支付订单、banner-home/sidebar-docs 广告位均显示。
  2. 订单 tab：命令栏 `biz.order.new E2E 浏览器 | 39 | E2E 套餐 | alipay` → 新订单出现；
     行内「支付」→ 提示 39 已支付；行内「退款」→ 提示 39 已退款。
  3. 订阅方案 tab 显示 `~/biz/plans` 与 MRR；广告位 tab 显示 `~/biz/ads`、预算 / 消耗列。
  4. member 打开面板 → `403 · ~/biz 仅 owner 可访问`；guest 同样 403。
  5. 截图检查：标题栏 / 摘要 / tabs / 命令栏 / KPI / 行式表格符合终端风格，无表单卡片。
- E2E 创建的订单已通过 API 清理；保留 seed 演示数据在 lion 名下。

## 遗留

1. **没有真实支付与退款**：未接入支付宝 / 微信下单、回调验签、对账与退款接口；订单状态完全手动流转。
2. **MRR 依赖手动订阅人数**：不是由订单 / 订阅生命周期推导；没有订阅到期、续费、流失率与 cohort 分析。
3. **没有周期扣款 / 自动续费**：`cycle` 只用于 MRR 摊平，不触发任何账单或提醒。
4. **广告只记预算 / 消耗**：没有展示量、点击、CTR、CPC 结算与第三方广告平台对接；消耗不会自动增长。
5. **项目维度较浅**：`projectId` 可关联但面板没有项目选择器，也没做按项目拆分的收入 / 广告报表。
6. **没有趋势图与导出**：只有当期 KPI 与列表，无月度趋势、环比、CSV 导出。
7. **没有审计与账单号**：订单无外部交易号、操作人、支付凭证；删除订单仅 API 支持，面板未开放。
8. **只有 owner 可访问**：没有拆分「财务只读」或「运营可写」等更细角色。
9. **无自动 seed 清理**：演示数据与真实记账共用同一套表，删除需逐条操作或手动清库。
