import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  CrmCustomerDto,
  CrmCustomerInput,
  CrmCustomerPatchInput,
  CrmDigestDto,
  CrmFollowUpDto,
  CrmFollowUpInput,
  CrmFollowUpKind,
  CrmSeedResult,
  CrmStage,
} from "@aiwb/shared";
import { CRM_STALE_DAYS } from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { crmCustomers, crmFollowUps, projects } from "../db/schema";

const MAX_NAME = 40;
const MAX_COMPANY = 60;
const MAX_CONTACT = 80;
const MAX_SOURCE = 40;
const MAX_NOTES = 500;
const MAX_CONTENT = 500;
const MAX_QUERY = 80;
const DAY = 24 * 60 * 60 * 1000;

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function idOrNull(v: unknown): string | null {
  const s = text(v, 64);
  return s || null;
}

/** 非负金额（元），取整落库 */
function amount(v: unknown, fallback = 0, label = "金额"): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${label}需为非负数字`);
  return Math.round(n);
}

/** 0–100 的评分 */
function score(v: unknown, fallback = 0): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BadRequestException("score 需为 0–100 的数字");
  return Math.min(100, Math.max(0, Math.round(n)));
}

function timestamp(v: unknown, fallback: Date): Date {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new BadRequestException("时间需为毫秒时间戳");
  return new Date(n);
}

function normalizeStage(v: unknown, fallback: CrmStage = "lead"): CrmStage {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  const map: Record<string, CrmStage> = {
    lead: "lead",
    "线索": "lead",
    "新线索": "lead",
    contacted: "contacted",
    contact: "contacted",
    "已联系": "contacted",
    "跟进中": "contacted",
    proposal: "proposal",
    quote: "proposal",
    "报价": "proposal",
    "已报价": "proposal",
    negotiation: "negotiation",
    negotiating: "negotiation",
    "洽谈": "negotiation",
    "成交在望": "negotiation",
    won: "won",
    win: "won",
    "成交": "won",
    "已成交": "won",
    lost: "lost",
    lose: "lost",
    "流失": "lost",
    "已流失": "lost",
  };
  const st = map[s];
  if (!st) throw new BadRequestException("stage 仅支持 lead / contacted / proposal / negotiation / won / lost");
  return st;
}

function normalizeKind(v: unknown, fallback: CrmFollowUpKind = "note"): CrmFollowUpKind {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  const map: Record<string, CrmFollowUpKind> = {
    lead: "lead",
    "线索": "lead",
    call: "call",
    "通话": "call",
    "电话": "call",
    meeting: "meeting",
    "会议": "meeting",
    email: "email",
    "邮件": "email",
    quote: "quote",
    "报价": "quote",
    note: "note",
    "备注": "note",
  };
  const k = map[s];
  if (!k) throw new BadRequestException("kind 仅支持 lead / call / meeting / email / quote / note");
  return k;
}

const fmtMoney = (n: number) => `¥${n.toLocaleString("zh-CN")}`;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY);
}

@Injectable()
export class CrmService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private toFollowUpDto(row: typeof crmFollowUps.$inferSelect): CrmFollowUpDto {
    return {
      id: row.id,
      customerId: row.customerId,
      kind: row.kind,
      content: row.content,
      happenedAt: row.happenedAt.getTime(),
      createdAt: row.createdAt.getTime(),
    };
  }

  private toCustomerDto(
    row: typeof crmCustomers.$inferSelect,
    projectName: string | null,
    followUps: CrmFollowUpDto[],
  ): CrmCustomerDto {
    const lastContactAt = row.lastContactAt.getTime();
    const daysSinceContact = Math.max(0, Math.floor((Date.now() - lastContactAt) / DAY));
    const latest = followUps[0] ?? null;
    return {
      id: row.id,
      projectId: row.projectId,
      projectName,
      name: row.name,
      company: row.company,
      contact: row.contact,
      stage: row.stage,
      value: row.value,
      source: row.source,
      score: row.score,
      notes: row.notes,
      lastContactAt,
      daysSinceContact,
      stale: row.stage !== "won" && row.stage !== "lost" && daysSinceContact > CRM_STALE_DAYS,
      followUpCount: followUps.length,
      lastFollowUp: latest?.content ?? null,
      lastFollowUpAt: latest?.happenedAt ?? null,
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

  async listCustomers(
    userId: string,
    filter: { stage?: string; q?: string; stale?: boolean } = {},
  ): Promise<CrmCustomerDto[]> {
    const [rows, followRows] = await Promise.all([
      this.db
        .select({ customer: crmCustomers, projectName: projects.name })
        .from(crmCustomers)
        .leftJoin(projects, eq(crmCustomers.projectId, projects.id))
        .where(eq(crmCustomers.ownerId, userId))
        .orderBy(desc(crmCustomers.lastContactAt)),
      this.db
        .select()
        .from(crmFollowUps)
        .where(eq(crmFollowUps.ownerId, userId))
        .orderBy(desc(crmFollowUps.happenedAt)),
    ]);

    const grouped = new Map<string, CrmFollowUpDto[]>();
    for (const f of followRows) {
      const dto = this.toFollowUpDto(f);
      const list = grouped.get(f.customerId);
      if (list) list.push(dto);
      else grouped.set(f.customerId, [dto]);
    }

    let list = rows.map((r) =>
      this.toCustomerDto(r.customer, r.projectName, grouped.get(r.customer.id) ?? []),
    );

    if (filter.stage && filter.stage !== "all") {
      const stage = normalizeStage(filter.stage);
      list = list.filter((c) => c.stage === stage);
    }
    if (filter.stale) list = list.filter((c) => c.stale);

    const q = text(filter.q, MAX_QUERY).toLowerCase();
    if (q) {
      list = list.filter((c) =>
        `${c.name}\n${c.company}\n${c.contact}\n${c.source}\n${c.notes}`.toLowerCase().includes(q),
      );
    }
    return list;
  }

  private async ownedCustomer(userId: string, id: string) {
    const [row] = await this.db
      .select({ customer: crmCustomers, projectName: projects.name })
      .from(crmCustomers)
      .leftJoin(projects, eq(crmCustomers.projectId, projects.id))
      .where(and(eq(crmCustomers.id, id), eq(crmCustomers.ownerId, userId)));
    if (!row) throw new NotFoundException("客户不存在");
    return row;
  }

  async getCustomer(userId: string, id: string): Promise<CrmCustomerDto> {
    const row = await this.ownedCustomer(userId, id);
    const follows = await this.listFollowUps(userId, id);
    return this.toCustomerDto(row.customer, row.projectName, follows);
  }

  async createCustomer(userId: string, input: CrmCustomerInput): Promise<CrmCustomerDto> {
    const name = text(input?.name, MAX_NAME);
    if (!name) throw new BadRequestException("客户姓名不能为空");
    const projectId = idOrNull(input?.projectId);
    await this.ownedProject(userId, projectId);

    const now = new Date();
    const row: typeof crmCustomers.$inferSelect = {
      id: randomUUID(),
      ownerId: userId,
      projectId,
      name,
      company: text(input?.company, MAX_COMPANY),
      contact: text(input?.contact, MAX_CONTACT),
      stage: normalizeStage(input?.stage),
      value: amount(input?.value, 0, "预计金额"),
      source: text(input?.source, MAX_SOURCE),
      score: score(input?.score, 0),
      notes: text(input?.notes, MAX_NOTES),
      lastContactAt: timestamp(input?.lastContactAt, now),
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(crmCustomers).values(row);
    return this.getCustomer(userId, row.id);
  }

  async patchCustomer(
    userId: string,
    id: string,
    patch: CrmCustomerPatchInput,
  ): Promise<CrmCustomerDto> {
    const { customer } = await this.ownedCustomer(userId, id);
    await this.db
      .update(crmCustomers)
      .set({
        name: patch?.name === undefined ? customer.name : text(patch.name, MAX_NAME) || customer.name,
        company:
          patch?.company === undefined ? customer.company : text(patch.company, MAX_COMPANY),
        contact:
          patch?.contact === undefined ? customer.contact : text(patch.contact, MAX_CONTACT),
        stage:
          patch?.stage === undefined ? customer.stage : normalizeStage(patch.stage, customer.stage),
        value: patch?.value === undefined ? customer.value : amount(patch.value, customer.value, "预计金额"),
        source: patch?.source === undefined ? customer.source : text(patch.source, MAX_SOURCE),
        score: patch?.score === undefined ? customer.score : score(patch.score, customer.score),
        notes: patch?.notes === undefined ? customer.notes : text(patch.notes, MAX_NOTES),
        updatedAt: new Date(),
      })
      .where(eq(crmCustomers.id, id));
    return this.getCustomer(userId, id);
  }

  async removeCustomer(userId: string, id: string) {
    const { customer } = await this.ownedCustomer(userId, id);
    await this.db.delete(crmCustomers).where(eq(crmCustomers.id, customer.id));
  }

  async listFollowUps(userId: string, customerId: string): Promise<CrmFollowUpDto[]> {
    await this.ownedCustomer(userId, customerId);
    const rows = await this.db
      .select()
      .from(crmFollowUps)
      .where(eq(crmFollowUps.customerId, customerId))
      .orderBy(desc(crmFollowUps.happenedAt));
    return rows.map((r) => this.toFollowUpDto(r));
  }

  async addFollowUp(
    userId: string,
    customerId: string,
    input: CrmFollowUpInput,
  ): Promise<CrmFollowUpDto> {
    const { customer } = await this.ownedCustomer(userId, customerId);
    const content = text(input?.content, MAX_CONTENT);
    if (!content) throw new BadRequestException("跟进内容不能为空");

    const now = new Date();
    const happenedAt = timestamp(input?.happenedAt, now);
    const row: typeof crmFollowUps.$inferSelect = {
      id: randomUUID(),
      ownerId: userId,
      customerId: customer.id,
      kind: normalizeKind(input?.kind),
      content,
      happenedAt,
      createdAt: now,
    };
    await this.db.insert(crmFollowUps).values(row);

    // 只有更新的跟进才会推进 lastContactAt，回填历史不改变最近联系时间
    if (happenedAt.getTime() > customer.lastContactAt.getTime()) {
      await this.db
        .update(crmCustomers)
        .set({ lastContactAt: happenedAt, updatedAt: now })
        .where(eq(crmCustomers.id, customer.id));
    }
    return this.toFollowUpDto(row);
  }

  async removeFollowUp(userId: string, customerId: string, followUpId: string) {
    const { customer } = await this.ownedCustomer(userId, customerId);
    const [row] = await this.db
      .select()
      .from(crmFollowUps)
      .where(and(eq(crmFollowUps.id, followUpId), eq(crmFollowUps.customerId, customer.id)));
    if (!row) throw new NotFoundException("跟进记录不存在");
    await this.db.delete(crmFollowUps).where(eq(crmFollowUps.id, followUpId));

    // 删除后回退到剩余的最近一条跟进，没有则回到建档时间
    const [latest] = await this.db
      .select({ happenedAt: crmFollowUps.happenedAt })
      .from(crmFollowUps)
      .where(eq(crmFollowUps.customerId, customer.id))
      .orderBy(desc(crmFollowUps.happenedAt))
      .limit(1);
    await this.db
      .update(crmCustomers)
      .set({ lastContactAt: latest?.happenedAt ?? customer.createdAt, updatedAt: new Date() })
      .where(eq(crmCustomers.id, customer.id));
  }

  /** AI 工具：按 id / 姓名 / 公司关键词定位客户 */
  async findCustomerByKey(userId: string, key: string): Promise<CrmCustomerDto> {
    const q = key.trim();
    if (!q) throw new BadRequestException("缺少客户 id 或关键词");
    const list = await this.listCustomers(userId);
    const found =
      list.find((c) => c.id === q) ??
      list.find((c) => c.name.includes(q)) ??
      list.find((c) => c.company.includes(q));
    if (!found) throw new NotFoundException(`未找到客户「${q}」`);
    return found;
  }

  async digest(userId: string): Promise<CrmDigestDto> {
    const list = await this.listCustomers(userId);
    const followRows = await this.db
      .select({ happenedAt: crmFollowUps.happenedAt })
      .from(crmFollowUps)
      .where(eq(crmFollowUps.ownerId, userId));

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const weekStart = Date.now() - 7 * DAY;

    let active = 0;
    let stale = 0;
    let won = 0;
    let lost = 0;
    let pipelineValue = 0;
    let wonValue = 0;
    let monthNew = 0;

    for (const c of list) {
      if (c.stage === "won") {
        won += 1;
        wonValue += c.value;
      } else if (c.stage === "lost") {
        lost += 1;
      } else {
        active += 1;
        pipelineValue += c.value;
        if (c.stale) stale += 1;
      }
      if (c.createdAt >= startOfMonth.getTime()) monthNew += 1;
    }

    const weekFollowUps = followRows.filter((f) => f.happenedAt.getTime() >= weekStart).length;
    const hasData = list.length > 0;
    const summary = hasData
      ? `${list.length} 位客户 · 管道 ${fmtMoney(pipelineValue)} · 成交 ${won} 位 · ${stale} 位超过 ${CRM_STALE_DAYS} 天未跟进`
      : "暂无客户数据 — 输入 crm.seed 生成演示数据";

    return {
      total: list.length,
      active,
      stale,
      won,
      lost,
      pipelineValue,
      wonValue,
      monthNew,
      weekFollowUps,
      summary,
    };
  }

  /** 演示数据：仅在用户完全没有客户时写入，避免重复污染 */
  async seed(userId: string): Promise<CrmSeedResult> {
    const existing = await this.db
      .select({ id: crmCustomers.id })
      .from(crmCustomers)
      .where(eq(crmCustomers.ownerId, userId));
    if (existing.length > 0) return { seeded: false, customers: 0, followUps: 0 };

    const customerFixtures: {
      name: string;
      company: string;
      contact: string;
      stage: CrmStage;
      value: number;
      source: string;
      score: number;
      notes: string;
      lastContactDays: number;
      createdDays: number;
    }[] = [
      {
        name: "陈静",
        company: "星云科技",
        contact: "chenjing@nebula.co",
        stage: "proposal",
        value: 18000,
        source: "官网表单",
        score: 82,
        notes: "报价单 v2 已发，等回复 · 对方已读 · 预计本周回复",
        lastContactDays: 1,
        createdDays: 13,
      },
      {
        name: "王硕",
        company: "独立开发者",
        contact: "wangshuo@dev.im",
        stage: "negotiation",
        value: 1188,
        source: "老客户",
        score: 76,
        notes: "续约意向明确 · pro → team 升级洽谈中",
        lastContactDays: 3,
        createdDays: 10,
      },
      {
        name: "刘一帆",
        company: "蓝图教育",
        contact: "liuyifan@lanedu.cn",
        stage: "contacted",
        value: 9600,
        source: "朋友介绍",
        score: 64,
        notes: "方案确认阶段停滞 · AI: 20 天未联系，建议今日触达",
        lastContactDays: 20,
        createdDays: 25,
      },
      {
        name: "anna chen",
        company: "overseas",
        contact: "anna@oversea.io",
        stage: "won",
        value: 23760,
        source: "官网表单",
        score: 90,
        notes: "合同已签，进入交付 · team 版 · 交付里程碑 2/5",
        lastContactDays: 35,
        createdDays: 50,
      },
      {
        name: "周凯",
        company: "个人咨询",
        contact: "zhoukai@qq.com",
        stage: "lost",
        value: 5800,
        source: "转介绍",
        score: 45,
        notes: "预算不足，暂缓 · AI: 可转介绍 pro 个人版",
        lastContactDays: 79,
        createdDays: 95,
      },
    ];

    const customerIds = new Map<string, string>();
    for (const f of customerFixtures) {
      const id = randomUUID();
      customerIds.set(f.name, id);
      const createdAt = daysAgo(f.createdDays);
      await this.db.insert(crmCustomers).values({
        id,
        ownerId: userId,
        projectId: null,
        name: f.name,
        company: f.company,
        contact: f.contact,
        stage: f.stage,
        value: f.value,
        source: f.source,
        score: f.score,
        notes: f.notes,
        lastContactAt: daysAgo(f.lastContactDays),
        createdAt,
        updatedAt: createdAt,
      });
    }

    const followFixtures: {
      customerName: string;
      kind: CrmFollowUpKind;
      content: string;
      days: number;
    }[] = [
      {
        customerName: "陈静",
        kind: "quote",
        content: "发送报价单 v2（¥18,000/年）· 邮件已送达 · 对方已读",
        days: 1,
      },
      {
        customerName: "陈静",
        kind: "meeting",
        content: "线上会议 45min · 确认 3 个定制需求：私有化部署、SSO、审计日志",
        days: 6,
      },
      {
        customerName: "陈静",
        kind: "lead",
        content: "首次接触 · 来自官网表单 · AI 自动建档并打分 82/100",
        days: 13,
      },
      {
        customerName: "王硕",
        kind: "note",
        content: "沟通 pro → team 升级，报价 team 年付",
        days: 3,
      },
      {
        customerName: "刘一帆",
        kind: "meeting",
        content: "方案确认会 · 等对方内部评估，暂无新进展",
        days: 20,
      },
      {
        customerName: "anna chen",
        kind: "note",
        content: "合同签署完成，进入交付里程碑 2/5",
        days: 35,
      },
      {
        customerName: "anna chen",
        kind: "meeting",
        content: "kickoff 会议 · 确认团队版账号与交付排期",
        days: 48,
      },
      {
        customerName: "周凯",
        kind: "call",
        content: "预算不足，暂缓采购 · 建议转介绍 pro 个人版",
        days: 79,
      },
      {
        customerName: "周凯",
        kind: "lead",
        content: "转介绍线索 · 个人咨询方向",
        days: 95,
      },
    ];

    for (const f of followFixtures) {
      const customerId = customerIds.get(f.customerName);
      if (!customerId) continue;
      await this.db.insert(crmFollowUps).values({
        id: randomUUID(),
        ownerId: userId,
        customerId,
        kind: f.kind,
        content: f.content,
        happenedAt: daysAgo(f.days),
        createdAt: daysAgo(f.days),
      });
    }

    return { seeded: true, customers: customerFixtures.length, followUps: followFixtures.length };
  }
}
