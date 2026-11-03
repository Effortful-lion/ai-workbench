/** 客户管理（crm 模块）共享类型 —— 客户档案 + 跟进时间线 */

export const CRM_STAGES = ["lead", "contacted", "proposal", "negotiation", "won", "lost"] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export const CRM_FOLLOWUP_KINDS = ["lead", "call", "meeting", "email", "quote", "note"] as const;
export type CrmFollowUpKind = (typeof CRM_FOLLOWUP_KINDS)[number];

/** 超过该天数未跟进即标黄（仅对未成交 / 未流失客户生效） */
export const CRM_STALE_DAYS = 14;

/** 客户档案：估值按元存储，阶段推进由人维护 */
export interface CrmCustomerDto {
  id: string;
  projectId: string | null;
  projectName: string | null;
  name: string;
  company: string;
  /** 联系人方式：邮箱 / 微信 / 电话 */
  contact: string;
  stage: CrmStage;
  /** 预计成交金额（元 / 年） */
  value: number;
  source: string;
  /** 线索评分 0–100 */
  score: number;
  notes: string;
  /** 最近一次跟进时间（由跟进记录推导，无记录时为建档时间） */
  lastContactAt: number;
  /** 距最近一次跟进的天数 */
  daysSinceContact: number;
  /** 未成交 / 未流失且超过 CRM_STALE_DAYS 天未跟进 */
  stale: boolean;
  followUpCount: number;
  lastFollowUp: string | null;
  lastFollowUpAt: number | null;
  createdAt: number;
}

export interface CrmCustomerInput {
  projectId?: string | null;
  name: string;
  company?: string;
  contact?: string;
  stage?: CrmStage;
  value?: number;
  source?: string;
  score?: number;
  notes?: string;
  /** 毫秒时间戳；缺省为建档时间，用于导入历史客户 */
  lastContactAt?: number;
}

export interface CrmCustomerPatchInput {
  name?: string;
  company?: string;
  contact?: string;
  stage?: CrmStage;
  value?: number;
  source?: string;
  score?: number;
  notes?: string;
}

/** 跟进记录：一条时间线事件，happenedAt 可回填历史 */
export interface CrmFollowUpDto {
  id: string;
  customerId: string;
  kind: CrmFollowUpKind;
  content: string;
  happenedAt: number;
  createdAt: number;
}

export interface CrmFollowUpInput {
  kind?: CrmFollowUpKind;
  content: string;
  /** 毫秒时间戳；缺省为当前时间 */
  happenedAt?: number;
}

/** 客户概览：驱动面板 KPI 与 AI 摘要 */
export interface CrmDigestDto {
  total: number;
  /** 未成交 / 未流失 */
  active: number;
  stale: number;
  won: number;
  lost: number;
  /** 进行中客户的预计成交金额合计 */
  pipelineValue: number;
  /** 已成交客户的合同金额合计 */
  wonValue: number;
  /** 本月新增客户 */
  monthNew: number;
  /** 近 7 天跟进记录数 */
  weekFollowUps: number;
  summary: string;
}

/** 演示数据：客户档案与跟进时间线样本 */
export interface CrmSeedResult {
  seeded: boolean;
  customers: number;
  followUps: number;
}
