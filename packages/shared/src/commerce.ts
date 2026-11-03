/** 商业化管理（commerce 模块）共享类型 —— 订阅方案 + 支付流水 + 广告位 */

export const COMMERCE_PLAN_CYCLES = ["monthly", "yearly"] as const;
export type CommercePlanCycle = (typeof COMMERCE_PLAN_CYCLES)[number];

export const COMMERCE_PLAN_STATUSES = ["active", "archived"] as const;
export type CommercePlanStatus = (typeof COMMERCE_PLAN_STATUSES)[number];

export const COMMERCE_ORDER_STATUSES = ["pending", "paid", "refunded"] as const;
export type CommerceOrderStatus = (typeof COMMERCE_ORDER_STATUSES)[number];

export const COMMERCE_CHANNELS = ["alipay", "wechat", "manual", "other"] as const;
export type CommerceChannel = (typeof COMMERCE_CHANNELS)[number];

export const COMMERCE_AD_STATUSES = ["planned", "active", "paused", "ended"] as const;
export type CommerceAdStatus = (typeof COMMERCE_AD_STATUSES)[number];

export const COMMERCE_AD_CHANNELS = ["web", "social", "search", "other"] as const;
export type CommerceAdChannel = (typeof COMMERCE_AD_CHANNELS)[number];

/** 订阅方案：价格按元存储，订阅人数手动维护，MRR 由二者推导 */
export interface CommercePlanDto {
  id: string;
  projectId: string | null;
  /** 关联项目名，无关联时为 null */
  projectName: string | null;
  name: string;
  price: number;
  cycle: CommercePlanCycle;
  status: CommercePlanStatus;
  subscribers: number;
  /** 月度经常性收入贡献：monthly = price × subscribers；yearly = 年费 / 12 */
  mrr: number;
  createdAt: number;
}

export interface CommercePlanInput {
  projectId?: string | null;
  name: string;
  price: number;
  cycle?: CommercePlanCycle;
  status?: CommercePlanStatus;
  subscribers?: number;
}

export interface CommercePlanPatchInput {
  name?: string;
  price?: number;
  cycle?: CommercePlanCycle;
  status?: CommercePlanStatus;
  subscribers?: number;
}

/** 支付流水：一期为本地记账，不接真实支付网关 */
export interface CommerceOrderDto {
  id: string;
  projectId: string | null;
  projectName: string | null;
  planId: string | null;
  planName: string | null;
  customerName: string;
  /** 商品 / 服务说明，缺省取方案名 */
  item: string;
  amount: number;
  channel: CommerceChannel;
  status: CommerceOrderStatus;
  paidAt: number | null;
  createdAt: number;
}

export interface CommerceOrderInput {
  projectId?: string | null;
  planId?: string | null;
  customerName: string;
  item?: string;
  amount: number;
  channel?: CommerceChannel;
  status?: CommerceOrderStatus;
  /** true 时直接记为已支付，paidAt = 当前时间 */
  paid?: boolean;
}

export interface CommerceOrderPatchInput {
  status?: CommerceOrderStatus;
}

/** 广告位：预算 / 消耗 / 状态，单击结算细节留到后续版本 */
export interface CommerceAdDto {
  id: string;
  projectId: string | null;
  projectName: string | null;
  name: string;
  channel: CommerceAdChannel;
  budget: number;
  spend: number;
  status: CommerceAdStatus;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
}

export interface CommerceAdInput {
  projectId?: string | null;
  name: string;
  channel?: CommerceAdChannel;
  budget: number;
  spend?: number;
  status?: CommerceAdStatus;
  startedAt?: number | null;
  endedAt?: number | null;
}

export interface CommerceAdPatchInput {
  name?: string;
  budget?: number;
  spend?: number;
  status?: CommerceAdStatus;
}

/** 商业化概览：驱动面板 KPI 条与 AI 摘要 */
export interface CommerceDigestDto {
  plans: number;
  activePlans: number;
  subscribers: number;
  /** 月度经常性收入 */
  mrr: number;
  /** 累计支付金额（已支付订单） */
  revenue: number;
  /** 本月支付金额（本地时区） */
  monthRevenue: number;
  /** 累计退款金额 */
  refunded: number;
  orders: number;
  pending: number;
  paid: number;
  /** 广告累计消耗 / 累计预算 */
  adSpend: number;
  adBudget: number;
  /** 净收入 = 累计支付 − 退款 − 广告消耗 */
  net: number;
  /** 如「MRR ¥8,674 · 本月支付 ¥1,283 · 广告消耗 ¥1,030」 */
  summary: string;
}

/** 演示数据：本地记账样本，便于面板与 AI 工具直接体验 */
export interface CommerceSeedResult {
  seeded: boolean;
  plans: number;
  orders: number;
  ads: number;
}
