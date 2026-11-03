import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  CommerceAdChannel,
  CommerceAdDto,
  CommerceAdInput,
  CommerceAdPatchInput,
  CommerceAdStatus,
  CommerceChannel,
  CommerceDigestDto,
  CommerceOrderDto,
  CommerceOrderInput,
  CommerceOrderStatus,
  CommercePlanCycle,
  CommercePlanDto,
  CommercePlanInput,
  CommercePlanPatchInput,
  CommercePlanStatus,
  CommerceSeedResult,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { commerceAds, commerceOrders, commercePlans, projects } from "../db/schema";

const MAX_NAME = 40;
const MAX_CUSTOMER = 60;
const MAX_ITEM = 120;
const MAX_QUERY = 80;

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function idOrNull(v: unknown): string | null {
  const s = text(v, 64);
  return s || null;
}

function amount(v: unknown, fallback = 0, label = "金额"): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${label}需为非负数字`);
  return Math.round(n);
}

function normalizeCycle(v: unknown, fallback: CommercePlanCycle = "monthly"): CommercePlanCycle {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  const map: Record<string, CommercePlanCycle> = {
    monthly: "monthly",
    month: "monthly",
    "月": "monthly",
    "月付": "monthly",
    yearly: "yearly",
    year: "yearly",
    annual: "yearly",
    "年": "yearly",
    "年付": "yearly",
  };
  const c = map[s];
  if (!c) throw new BadRequestException("cycle 仅支持 monthly / yearly");
  return c;
}

function normalizePlanStatus(v: unknown, fallback: CommercePlanStatus = "active"): CommercePlanStatus {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  const map: Record<string, CommercePlanStatus> = {
    active: "active",
    archived: "archived",
    archive: "archived",
    "运营中": "active",
    "停售": "archived",
  };
  const st = map[s];
  if (!st) throw new BadRequestException("status 仅支持 active / archived");
  return st;
}

function normalizeOrderStatus(
  v: unknown,
  fallback: CommerceOrderStatus = "pending",
): CommerceOrderStatus {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  const map: Record<string, CommerceOrderStatus> = {
    pending: "pending",
    paid: "paid",
    refunded: "refunded",
    refund: "refunded",
    "待支付": "pending",
    "已支付": "paid",
    "已退款": "refunded",
  };
  const st = map[s];
  if (!st) throw new BadRequestException("订单 status 仅支持 pending / paid / refunded");
  return st;
}

function normalizeChannel(v: unknown, fallback: CommerceChannel = "manual"): CommerceChannel {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  const map: Record<string, CommerceChannel> = {
    alipay: "alipay",
    wechat: "wechat",
    wx: "wechat",
    manual: "manual",
    other: "other",
    "支付宝": "alipay",
    "微信": "wechat",
    "手动": "manual",
    "其他": "other",
  };
  const c = map[s];
  if (!c) throw new BadRequestException("channel 仅支持 alipay / wechat / manual / other");
  return c;
}

function normalizeAdStatus(v: unknown, fallback: CommerceAdStatus = "planned"): CommerceAdStatus {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  const map: Record<string, CommerceAdStatus> = {
    planned: "planned",
    plan: "planned",
    active: "active",
    paused: "paused",
    pause: "paused",
    ended: "ended",
    end: "ended",
    "计划": "planned",
    "在线": "active",
    "暂停": "paused",
    "结束": "ended",
  };
  const st = map[s];
  if (!st) throw new BadRequestException("广告 status 仅支持 planned / active / paused / ended");
  return st;
}

function normalizeAdChannel(v: unknown, fallback: CommerceAdChannel = "web"): CommerceAdChannel {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  const map: Record<string, CommerceAdChannel> = {
    web: "web",
    site: "web",
    social: "social",
    xhs: "social",
    search: "search",
    other: "other",
    "网站": "web",
    "社交": "social",
    "搜索": "search",
    "其他": "other",
  };
  const c = map[s];
  if (!c) throw new BadRequestException("广告 channel 仅支持 web / social / search / other");
  return c;
}

const fmtMoney = (n: number) => `¥${n.toLocaleString("zh-CN")}`;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

@Injectable()
export class CommerceService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private planMrr(row: typeof commercePlans.$inferSelect): number {
    if (row.cycle === "monthly") return row.price * row.subscribers;
    return Math.round((row.price * row.subscribers) / 12);
  }

  private toPlanDto(
    row: typeof commercePlans.$inferSelect,
    projectName: string | null,
  ): CommercePlanDto {
    return {
      id: row.id,
      projectId: row.projectId,
      projectName,
      name: row.name,
      price: row.price,
      cycle: row.cycle,
      status: row.status,
      subscribers: row.subscribers,
      mrr: this.planMrr(row),
      createdAt: row.createdAt.getTime(),
    };
  }

  private toOrderDto(
    row: typeof commerceOrders.$inferSelect,
    planName: string | null,
    projectName: string | null,
  ): CommerceOrderDto {
    return {
      id: row.id,
      projectId: row.projectId,
      projectName,
      planId: row.planId,
      planName,
      customerName: row.customerName,
      item: row.item || planName || "",
      amount: row.amount,
      channel: row.channel,
      status: row.status,
      paidAt: row.paidAt ? row.paidAt.getTime() : null,
      createdAt: row.createdAt.getTime(),
    };
  }

  private toAdDto(
    row: typeof commerceAds.$inferSelect,
    projectName: string | null,
  ): CommerceAdDto {
    return {
      id: row.id,
      projectId: row.projectId,
      projectName,
      name: row.name,
      channel: row.channel,
      budget: row.budget,
      spend: row.spend,
      status: row.status,
      startedAt: row.startedAt ? row.startedAt.getTime() : null,
      endedAt: row.endedAt ? row.endedAt.getTime() : null,
      createdAt: row.createdAt.getTime(),
    };
  }

  private async ownedProject(userId: string, projectId: string | null) {
    if (!projectId) return null;
    const [row] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)));
    if (!row) throw new BadRequestException("关联项目不存在");
    return row;
  }

  async listPlans(userId: string): Promise<CommercePlanDto[]> {
    const rows = await this.db
      .select({ plan: commercePlans, projectName: projects.name })
      .from(commercePlans)
      .leftJoin(projects, eq(commercePlans.projectId, projects.id))
      .where(eq(commercePlans.ownerId, userId))
      .orderBy(desc(commercePlans.createdAt));
    return rows.map((r) => this.toPlanDto(r.plan, r.projectName));
  }

  private async ownedPlan(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(commercePlans)
      .where(and(eq(commercePlans.id, id), eq(commercePlans.ownerId, userId)));
    if (!row) throw new NotFoundException("订阅方案不存在");
    return row;
  }

  async getPlan(userId: string, id: string): Promise<CommercePlanDto> {
    const row = await this.ownedPlan(userId, id);
    const project = row.projectId ? await this.ownedProject(userId, row.projectId) : null;
    return this.toPlanDto(row, project?.name ?? null);
  }

  async createPlan(userId: string, input: CommercePlanInput): Promise<CommercePlanDto> {
    const name = text(input?.name, MAX_NAME);
    if (!name) throw new BadRequestException("方案名称不能为空");
    const projectId = idOrNull(input?.projectId);
    await this.ownedProject(userId, projectId);

    const row: typeof commercePlans.$inferSelect = {
      id: randomUUID(),
      ownerId: userId,
      projectId,
      name,
      price: amount(input?.price, 0, "价格"),
      cycle: normalizeCycle(input?.cycle),
      status: normalizePlanStatus(input?.status),
      subscribers: amount(input?.subscribers, 0, "订阅人数"),
      createdAt: new Date(),
    };
    await this.db.insert(commercePlans).values(row);
    return this.getPlan(userId, row.id);
  }

  async patchPlan(userId: string, id: string, patch: CommercePlanPatchInput): Promise<CommercePlanDto> {
    const current = await this.ownedPlan(userId, id);
    await this.db
      .update(commercePlans)
      .set({
        name: patch?.name === undefined ? current.name : text(patch.name, MAX_NAME) || current.name,
        price: patch?.price === undefined ? current.price : amount(patch.price, current.price, "价格"),
        cycle: patch?.cycle === undefined ? current.cycle : normalizeCycle(patch.cycle, current.cycle),
        status:
          patch?.status === undefined ? current.status : normalizePlanStatus(patch.status, current.status),
        subscribers:
          patch?.subscribers === undefined
            ? current.subscribers
            : amount(patch.subscribers, current.subscribers, "订阅人数"),
      })
      .where(eq(commercePlans.id, id));
    return this.getPlan(userId, id);
  }

  async removePlan(userId: string, id: string) {
    await this.ownedPlan(userId, id);
    await this.db.delete(commercePlans).where(eq(commercePlans.id, id));
  }

  async listOrders(
    userId: string,
    filter: { status?: CommerceOrderStatus; q?: string } = {},
  ): Promise<CommerceOrderDto[]> {
    const rows = await this.db
      .select({ order: commerceOrders, planName: commercePlans.name, projectName: projects.name })
      .from(commerceOrders)
      .leftJoin(commercePlans, eq(commerceOrders.planId, commercePlans.id))
      .leftJoin(projects, eq(commerceOrders.projectId, projects.id))
      .where(eq(commerceOrders.ownerId, userId))
      .orderBy(desc(commerceOrders.createdAt));

    let list = rows.map((r) => this.toOrderDto(r.order, r.planName, r.projectName));
    if (filter.status) list = list.filter((o) => o.status === filter.status);
    const q = text(filter.q, MAX_QUERY).toLowerCase();
    if (q) {
      list = list.filter((o) =>
        `${o.customerName}\n${o.item}\n${o.planName ?? ""}\n${o.projectName ?? ""}`.toLowerCase().includes(q),
      );
    }
    return list;
  }

  private async ownedOrder(userId: string, id: string) {
    const [row] = await this.db
      .select({ order: commerceOrders, planName: commercePlans.name, projectName: projects.name })
      .from(commerceOrders)
      .leftJoin(commercePlans, eq(commerceOrders.planId, commercePlans.id))
      .leftJoin(projects, eq(commerceOrders.projectId, projects.id))
      .where(and(eq(commerceOrders.id, id), eq(commerceOrders.ownerId, userId)));
    if (!row) throw new NotFoundException("订单不存在");
    return row;
  }

  async getOrder(userId: string, id: string): Promise<CommerceOrderDto> {
    const row = await this.ownedOrder(userId, id);
    return this.toOrderDto(row.order, row.planName, row.projectName);
  }

  async createOrder(userId: string, input: CommerceOrderInput): Promise<CommerceOrderDto> {
    const customerName = text(input?.customerName, MAX_CUSTOMER);
    if (!customerName) throw new BadRequestException("客户名称不能为空");

    const planId = idOrNull(input?.planId);
    const plan = planId ? await this.ownedPlan(userId, planId) : null;
    const projectId = idOrNull(input?.projectId) ?? plan?.projectId ?? null;
    await this.ownedProject(userId, projectId);

    const status: CommerceOrderStatus = input?.status
      ? normalizeOrderStatus(input.status)
      : input?.paid
        ? "paid"
        : "pending";
    const now = new Date();
    const row: typeof commerceOrders.$inferSelect = {
      id: randomUUID(),
      ownerId: userId,
      projectId,
      planId: plan?.id ?? null,
      customerName,
      item: text(input?.item, MAX_ITEM) || plan?.name || "自定义订单",
      amount: amount(input?.amount, plan?.price ?? 0, "订单金额"),
      channel: normalizeChannel(input?.channel),
      status,
      paidAt: status === "paid" ? now : null,
      createdAt: now,
    };
    await this.db.insert(commerceOrders).values(row);
    return this.getOrder(userId, row.id);
  }

  async payOrder(userId: string, id: string): Promise<CommerceOrderDto> {
    const row = await this.ownedOrder(userId, id);
    if (row.order.status === "refunded") throw new BadRequestException("已退款订单不能再次支付");
    if (row.order.status === "paid") return this.toOrderDto(row.order, row.planName, row.projectName);

    await this.db
      .update(commerceOrders)
      .set({ status: "paid", paidAt: new Date() })
      .where(eq(commerceOrders.id, id));
    return this.getOrder(userId, id);
  }

  async refundOrder(userId: string, id: string): Promise<CommerceOrderDto> {
    const row = await this.ownedOrder(userId, id);
    if (row.order.status !== "paid") throw new BadRequestException("只有已支付订单可退款");
    await this.db
      .update(commerceOrders)
      .set({ status: "refunded" })
      .where(eq(commerceOrders.id, id));
    return this.getOrder(userId, id);
  }

  async removeOrder(userId: string, id: string) {
    await this.ownedOrder(userId, id);
    await this.db.delete(commerceOrders).where(eq(commerceOrders.id, id));
  }

  /** AI 工具：按 id / 客户名 / 商品关键词定位订单 */
  async findOrderByKey(userId: string, key: string): Promise<CommerceOrderDto> {
    const q = key.trim();
    if (!q) throw new BadRequestException("缺少订单 id 或关键词");
    const list = await this.listOrders(userId);
    const found =
      list.find((o) => o.id === q) ??
      list.find((o) => o.customerName.includes(q)) ??
      list.find((o) => `${o.item} ${o.planName ?? ""}`.includes(q));
    if (!found) throw new NotFoundException(`未找到订单「${q}」`);
    return found;
  }

  async listAds(userId: string): Promise<CommerceAdDto[]> {
    const rows = await this.db
      .select({ ad: commerceAds, projectName: projects.name })
      .from(commerceAds)
      .leftJoin(projects, eq(commerceAds.projectId, projects.id))
      .where(eq(commerceAds.ownerId, userId))
      .orderBy(desc(commerceAds.createdAt));
    return rows.map((r) => this.toAdDto(r.ad, r.projectName));
  }

  private async ownedAd(userId: string, id: string) {
    const [row] = await this.db
      .select({ ad: commerceAds, projectName: projects.name })
      .from(commerceAds)
      .leftJoin(projects, eq(commerceAds.projectId, projects.id))
      .where(and(eq(commerceAds.id, id), eq(commerceAds.ownerId, userId)));
    if (!row) throw new NotFoundException("广告位不存在");
    return row;
  }

  async getAd(userId: string, id: string): Promise<CommerceAdDto> {
    const row = await this.ownedAd(userId, id);
    return this.toAdDto(row.ad, row.projectName);
  }

  async createAd(userId: string, input: CommerceAdInput): Promise<CommerceAdDto> {
    const name = text(input?.name, MAX_NAME);
    if (!name) throw new BadRequestException("广告位名称不能为空");
    const projectId = idOrNull(input?.projectId);
    await this.ownedProject(userId, projectId);

    const now = new Date();
    const status = normalizeAdStatus(input?.status);
    const row: typeof commerceAds.$inferSelect = {
      id: randomUUID(),
      ownerId: userId,
      projectId,
      name,
      channel: normalizeAdChannel(input?.channel),
      budget: amount(input?.budget, 0, "预算"),
      spend: amount(input?.spend, 0, "消耗"),
      status,
      startedAt:
        input?.startedAt === undefined || input.startedAt === null
          ? status === "active"
            ? now
            : null
          : new Date(Number(input.startedAt)),
      endedAt:
        input?.endedAt === undefined || input.endedAt === null
          ? status === "ended"
            ? now
            : null
          : new Date(Number(input.endedAt)),
      createdAt: now,
    };
    await this.db.insert(commerceAds).values(row);
    return this.getAd(userId, row.id);
  }

  async patchAd(userId: string, id: string, patch: CommerceAdPatchInput): Promise<CommerceAdDto> {
    const current = await this.ownedAd(userId, id);
    const row = current.ad;
    const nextStatus = patch?.status === undefined ? row.status : normalizeAdStatus(patch.status, row.status);
    const now = new Date();

    await this.db
      .update(commerceAds)
      .set({
        name: patch?.name === undefined ? row.name : text(patch.name, MAX_NAME) || row.name,
        budget: patch?.budget === undefined ? row.budget : amount(patch.budget, row.budget, "预算"),
        spend: patch?.spend === undefined ? row.spend : amount(patch.spend, row.spend, "消耗"),
        status: nextStatus,
        startedAt: nextStatus === "active" && !row.startedAt ? now : row.startedAt,
        endedAt: nextStatus === "ended" && !row.endedAt ? now : row.endedAt,
      })
      .where(eq(commerceAds.id, id));
    return this.getAd(userId, id);
  }

  async removeAd(userId: string, id: string) {
    await this.ownedAd(userId, id);
    await this.db.delete(commerceAds).where(eq(commerceAds.id, id));
  }

  /** AI 工具：按 id / 名称关键词定位广告位 */
  async findAdByKey(userId: string, key: string): Promise<CommerceAdDto> {
    const q = key.trim();
    if (!q) throw new BadRequestException("缺少广告位 id 或关键词");
    const list = await this.listAds(userId);
    const found = list.find((a) => a.id === q) ?? list.find((a) => a.name.includes(q));
    if (!found) throw new NotFoundException(`未找到广告位「${q}」`);
    return found;
  }

  async digest(userId: string): Promise<CommerceDigestDto> {
    const [plans, orders, ads] = await Promise.all([
      this.listPlans(userId),
      this.listOrders(userId),
      this.listAds(userId),
    ]);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    let mrr = 0;
    let subscribers = 0;
    let activePlans = 0;
    for (const p of plans) {
      if (p.status !== "active") continue;
      activePlans += 1;
      mrr += p.mrr;
      subscribers += p.subscribers;
    }

    let revenue = 0;
    let monthRevenue = 0;
    let refunded = 0;
    let pending = 0;
    let paid = 0;
    for (const o of orders) {
      if (o.status === "paid") {
        paid += 1;
        revenue += o.amount;
        if (o.paidAt !== null && o.paidAt >= startOfMonth.getTime()) monthRevenue += o.amount;
      } else if (o.status === "pending") pending += 1;
      else if (o.status === "refunded") refunded += o.amount;
    }

    let adSpend = 0;
    let adBudget = 0;
    for (const a of ads) {
      adSpend += a.spend;
      adBudget += a.budget;
    }

    const net = revenue - refunded - adSpend;
    const hasData = plans.length > 0 || orders.length > 0 || ads.length > 0;
    const summary = hasData
      ? `MRR ${fmtMoney(mrr)} · 本月支付 ${fmtMoney(monthRevenue)} · 广告消耗 ${fmtMoney(adSpend)}`
      : "暂无商业化数据 — 输入 biz.seed 生成演示数据";

    return {
      plans: plans.length,
      activePlans,
      subscribers,
      mrr,
      revenue,
      monthRevenue,
      refunded,
      orders: orders.length,
      pending,
      paid,
      adSpend,
      adBudget,
      net,
      summary,
    };
  }

  /** 演示数据：仅在用户完全没有商业化记录时写入，避免重复污染 */
  async seed(userId: string): Promise<CommerceSeedResult> {
    const [p, o, a] = await Promise.all([
      this.db.select({ id: commercePlans.id }).from(commercePlans).where(eq(commercePlans.ownerId, userId)),
      this.db.select({ id: commerceOrders.id }).from(commerceOrders).where(eq(commerceOrders.ownerId, userId)),
      this.db.select({ id: commerceAds.id }).from(commerceAds).where(eq(commerceAds.ownerId, userId)),
    ]);
    if (p.length > 0 || o.length > 0 || a.length > 0) {
      return { seeded: false, plans: 0, orders: 0, ads: 0 };
    }

    const now = new Date();
    const planFixtures: {
      name: string;
      price: number;
      cycle: CommercePlanCycle;
      status: CommercePlanStatus;
      subscribers: number;
    }[] = [
      { name: "pro", price: 29, cycle: "monthly", status: "active", subscribers: 62 },
      { name: "team", price: 99, cycle: "monthly", status: "active", subscribers: 24 },
      { name: "lifetime", price: 399, cycle: "yearly", status: "archived", subscribers: 8 },
    ];

    const planIds = new Map<string, string>();
    for (const f of planFixtures) {
      const id = randomUUID();
      planIds.set(f.name, id);
      await this.db.insert(commercePlans).values({
        id,
        ownerId: userId,
        projectId: null,
        name: f.name,
        price: f.price,
        cycle: f.cycle,
        status: f.status,
        subscribers: f.subscribers,
        createdAt: daysAgo(30),
      });
    }

    const orderFixtures: {
      customerName: string;
      planName: string;
      amount: number;
      channel: CommerceChannel;
      status: CommerceOrderStatus;
      ago: number;
    }[] = [
      { customerName: "陈静", planName: "pro", amount: 29, channel: "alipay", status: "paid", ago: 1 },
      { customerName: "王硕", planName: "team", amount: 99, channel: "wechat", status: "paid", ago: 2 },
      { customerName: "刘一帆", planName: "team", amount: 99, channel: "alipay", status: "pending", ago: 3 },
      { customerName: "anna chen", planName: "team", amount: 99, channel: "manual", status: "paid", ago: 4 },
      { customerName: "周凯", planName: "pro", amount: 29, channel: "alipay", status: "refunded", ago: 6 },
      { customerName: "林晨", planName: "lifetime", amount: 399, channel: "wechat", status: "paid", ago: 9 },
      { customerName: "陈静", planName: "pro", amount: 29, channel: "alipay", status: "paid", ago: 15 },
    ];

    for (const f of orderFixtures) {
      const createdAt = daysAgo(f.ago);
      await this.db.insert(commerceOrders).values({
        id: randomUUID(),
        ownerId: userId,
        projectId: null,
        planId: planIds.get(f.planName) ?? null,
        customerName: f.customerName,
        item: `${f.planName} 订阅`,
        amount: f.amount,
        channel: f.channel,
        status: f.status,
        paidAt: f.status === "paid" || f.status === "refunded" ? createdAt : null,
        createdAt,
      });
    }

    const adFixtures: {
      name: string;
      channel: CommerceAdChannel;
      budget: number;
      spend: number;
      status: CommerceAdStatus;
      ago: number;
    }[] = [
      { name: "banner-home", channel: "web", budget: 1500, spend: 620, status: "active", ago: 20 },
      { name: "sidebar-docs", channel: "web", budget: 800, spend: 410, status: "paused", ago: 30 },
      { name: "xhs-note", channel: "social", budget: 500, spend: 0, status: "planned", ago: 2 },
    ];

    for (const f of adFixtures) {
      await this.db.insert(commerceAds).values({
        id: randomUUID(),
        ownerId: userId,
        projectId: null,
        name: f.name,
        channel: f.channel,
        budget: f.budget,
        spend: f.spend,
        status: f.status,
        startedAt: f.status === "planned" ? null : daysAgo(f.ago),
        endedAt: null,
        createdAt: daysAgo(f.ago),
      });
    }

    return { seeded: true, plans: planFixtures.length, orders: orderFixtures.length, ads: adFixtures.length };
  }
}
