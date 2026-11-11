import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  NotificationDigestDto,
  NotificationDto,
  NotificationInput,
  NotificationScanResult,
  NotificationType,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { mailMessages, notifications, scheduleTasks } from "../db/schema";

const MAX_TITLE = 120;
const MAX_BODY = 2000;
/** 扫描窗口：只看最近 24 小时内开始 / 到点的日程，避免历史任务刷屏 */
const SCAN_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function normalizeType(v: unknown, fallback: NotificationType = "system"): NotificationType {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  const map: Record<string, NotificationType> = {
    system: "system",
    schedule: "schedule",
    mail: "mail",
    blog: "blog",
    "系统": "system",
    "日程": "schedule",
    "邮件": "mail",
    "博客": "blog",
  };
  const t = map[s];
  if (!t) throw new BadRequestException("type 仅支持 system / schedule / mail");
  return t;
}

const pad = (n: number) => String(n).padStart(2, "0");

function fmtDateTime(d: Date): string {
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function snippetOf(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 100);
}

@Injectable()
export class NotifyService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private toDto(row: typeof notifications.$inferSelect): NotificationDto {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      isRead: row.isRead,
      sourceId: row.sourceId,
      dedupeKey: row.dedupeKey,
      createdAt: row.createdAt.getTime(),
    };
  }

  /**
   * 收件箱列表。
   * @param discussionOnly 非 admin 只能看到「讨论类」（博客评论/回复）消息，
   *        日程、邮件、系统这类管理信息属于 admin 的工作流
   */
  async list(
    userId: string,
    filter: { type?: NotificationType; unreadOnly?: boolean } = {},
    discussionOnly = false,
  ): Promise<NotificationDto[]> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt));

    let list = rows.map((r) => this.toDto(r));
    if (discussionOnly) list = list.filter((n) => n.type === "blog");
    if (filter.type) list = list.filter((n) => n.type === filter.type);
    if (filter.unreadOnly) list = list.filter((n) => !n.isRead);
    return list;
  }

  async digest(userId: string, discussionOnly = false): Promise<NotificationDigestDto> {
    const all = await this.db
      .select({ type: notifications.type, isRead: notifications.isRead, createdAt: notifications.createdAt })
      .from(notifications)
      .where(eq(notifications.userId, userId));
    const rows = discussionOnly ? all.filter((n) => n.type === "blog") : all;

    const types: Record<NotificationType, number> = { system: 0, schedule: 0, mail: 0, blog: 0 };
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let unread = 0;
    let today = 0;
    for (const n of rows) {
      types[n.type] += 1;
      if (!n.isRead) unread += 1;
      if (n.createdAt.getTime() >= startOfDay.getTime()) today += 1;
    }

    const base = discussionOnly
      ? `评论 ${types.blog}`
      : `日程 ${types.schedule} · 邮件 ${types.mail} · 系统 ${types.system}`;
    const summary =
      rows.length === 0
        ? "暂无站内信 — 系统会在有提醒时自动投递"
        : unread > 0
          ? `${unread} unread · 今日 ${today} 条 · ${base}`
          : `全部已读 · 共 ${rows.length} 条 · ${base}`;

    return { total: rows.length, unread, today, types, summary };
  }

  private async push(
    userId: string,
    data: {
      type: NotificationType;
      title: string;
      body?: string;
      sourceId?: string | null;
      dedupeKey?: string | null;
      createdAt?: Date;
    },
  ): Promise<NotificationDto> {
    const row: typeof notifications.$inferSelect = {
      id: randomUUID(),
      userId,
      type: data.type,
      title: data.title.slice(0, MAX_TITLE),
      body: text(data.body, MAX_BODY),
      isRead: false,
      sourceId: data.sourceId ?? null,
      dedupeKey: data.dedupeKey ?? null,
      createdAt: data.createdAt ?? new Date(),
    };
    await this.db.insert(notifications).values(row);
    return this.toDto(row);
  }

  async create(userId: string, input: NotificationInput, allowAllTypes = true): Promise<NotificationDto> {
    const title = text(input?.title, MAX_TITLE);
    if (!title) throw new BadRequestException("通知标题不能为空");
    const type = normalizeType(input?.type);
    // 非 admin 的收件箱只有讨论类消息，不允许自己造日程/邮件/系统提醒
    if (!allowAllTypes && type !== "blog") {
      throw new BadRequestException("普通账号只能创建讨论类站内信");
    }
    return this.push(userId, {
      type,
      title,
      body: text(input?.body, MAX_BODY),
    });
  }

  async scan(userId: string): Promise<NotificationScanResult> {
    const now = new Date();
    const result: NotificationScanResult = { created: 0, skipped: 0, schedule: 0, mail: 0 };

    const existing = await this.db
      .select({ dedupeKey: notifications.dedupeKey })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNotNull(notifications.dedupeKey)));
    const seen = new Set(existing.map((r) => r.dedupeKey));

    const emit = async (data: {
      type: NotificationType;
      title: string;
      body: string;
      sourceId: string;
      dedupeKey: string;
      bucket: "schedule" | "mail";
    }) => {
      if (seen.has(data.dedupeKey)) {
        result.skipped += 1;
        return;
      }
      await this.push(userId, {
        type: data.type,
        title: data.title,
        body: data.body,
        sourceId: data.sourceId,
        dedupeKey: data.dedupeKey,
      });
      seen.add(data.dedupeKey);
      result.created += 1;
      result[data.bucket] += 1;
    };

    // 1) 待办日程：提醒时间已到，且任务开始时间在最近 24 小时内
    const tasks = await this.db
      .select()
      .from(scheduleTasks)
      .where(and(eq(scheduleTasks.ownerId, userId), eq(scheduleTasks.status, "pending")));
    const lookbackStart = now.getTime() - SCAN_LOOKBACK_MS;

    for (const t of tasks) {
      if (!t.remindAt) continue;
      if (t.remindAt.getTime() > now.getTime()) continue;
      if (t.startsAt.getTime() < lookbackStart) continue;

      const lines = [`开始：${fmtDateTime(t.startsAt)} · ${t.durationMin} 分钟`];
      if (t.location) lines.push(`地点：${t.location}`);
      if (t.notes) lines.push(`备注：${t.notes}`);
      await emit({
        type: "schedule",
        title: `日程提醒 · ${t.title}`,
        body: lines.join("\n"),
        sourceId: t.id,
        dedupeKey: `schedule:${t.id}:${t.remindAt.getTime()}`,
        bucket: "schedule",
      });
    }

    // 2) 收件箱里未读的重要邮件
    const mails = await this.db
      .select()
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.ownerId, userId),
          eq(mailMessages.folder, "inbox"),
          eq(mailMessages.isRead, false),
          eq(mailMessages.category, "important"),
        ),
      );

    for (const m of mails) {
      const lines: string[] = [];
      if (m.aiReason) lines.push(`AI：${m.aiReason}`);
      const snippet = snippetOf(m.body);
      if (snippet) lines.push(snippet);
      await emit({
        type: "mail",
        title: `${m.fromName || m.fromAddress} · ${m.subject}`,
        body: lines.join("\n"),
        sourceId: m.id,
        dedupeKey: `mail:${m.id}`,
        bucket: "mail",
      });
    }

    return result;
  }

  private async owned(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    if (!row) throw new NotFoundException("站内信不存在");
    return row;
  }

  async markRead(userId: string, id: string, isRead: boolean): Promise<NotificationDto> {
    const row = await this.owned(userId, id);
    await this.db.update(notifications).set({ isRead: Boolean(isRead) }).where(eq(notifications.id, id));
    return this.toDto({ ...row, isRead: Boolean(isRead) });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const rows = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    await this.db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return { updated: rows.length };
  }

  async remove(userId: string, id: string) {
    await this.owned(userId, id);
    await this.db.delete(notifications).where(eq(notifications.id, id));
  }

  /** AI 工具：按 id 或标题关键词定位一条站内信并标记已读 */
  async findByKey(userId: string, key: string): Promise<NotificationDto> {
    const q = key.trim();
    if (!q) throw new BadRequestException("缺少站内信 id 或关键词");
    const rows = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt));
    const found = rows.find((r) => r.id === q) ?? rows.find((r) => r.title.includes(q));
    if (!found) throw new NotFoundException(`未找到站内信「${q}」`);
    return this.markRead(userId, found.id, true);
  }
}
