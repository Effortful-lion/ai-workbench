import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  ScheduleTaskDto,
  ScheduleTaskInput,
  ScheduleTaskPatchInput,
  TaskPriority,
  TaskStatus,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { scheduleTasks } from "../db/schema";

const MAX_TITLE = 120;
const MAX_NOTES = 500;
const MAX_LOCATION = 100;
const DEFAULT_DURATION = 60;
const REMIND_BEFORE_MS = 10 * 60 * 1000;

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function normalizePriority(raw: unknown, fallback: TaskPriority = "normal"): TaskPriority {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const s = String(raw).trim().toLowerCase().replace(/^#/, "");
  const map: Record<string, TaskPriority> = {
    low: "low",
    normal: "normal",
    high: "high",
    "低": "low",
    "普通": "normal",
    "高": "high",
  };
  const p = map[s];
  if (!p) throw new BadRequestException("priority 仅支持 low / normal / high");
  return p;
}

function normalizeStatus(raw: unknown, fallback: TaskStatus = "pending"): TaskStatus {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const s = String(raw).trim().toLowerCase();
  const map: Record<string, TaskStatus> = {
    pending: "pending",
    done: "done",
    canceled: "canceled",
    cancelled: "canceled",
    "待办": "pending",
    "完成": "done",
    "取消": "canceled",
  };
  const st = map[s];
  if (!st) throw new BadRequestException("status 仅支持 pending / done / canceled");
  return st;
}

function normalizeStart(raw: unknown): Date {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : NaN;
  if (!Number.isFinite(n)) throw new BadRequestException("startsAt 不是合法时间");
  const d = new Date(n);
  if (d.getFullYear() < 2000 || d.getFullYear() > 2100) {
    throw new BadRequestException("startsAt 超出合理范围（2000–2100）");
  }
  return d;
}

function normalizeDuration(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 5 || n > 1440) {
    throw new BadRequestException("durationMin 需为 5–1440 的整数");
  }
  return n;
}

@Injectable()
export class ScheduleService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private toDto(row: typeof scheduleTasks.$inferSelect): ScheduleTaskDto {
    return {
      id: row.id,
      title: row.title,
      notes: row.notes,
      location: row.location,
      startsAt: row.startsAt.getTime(),
      endsAt: row.startsAt.getTime() + row.durationMin * 60 * 1000,
      durationMin: row.durationMin,
      remindAt: row.remindAt ? row.remindAt.getTime() : null,
      priority: row.priority,
      status: row.status,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  async list(userId: string): Promise<ScheduleTaskDto[]> {
    const rows = await this.db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.ownerId, userId))
      .orderBy(asc(scheduleTasks.startsAt));
    return rows.map((r) => this.toDto(r));
  }

  private async owned(id: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(scheduleTasks)
      .where(and(eq(scheduleTasks.id, id), eq(scheduleTasks.ownerId, userId)));
    if (!row) throw new NotFoundException("任务不存在");
    return row;
  }

  async create(userId: string, input: ScheduleTaskInput): Promise<ScheduleTaskDto> {
    const title = text(input?.title, MAX_TITLE);
    if (!title) throw new BadRequestException("任务标题不能为空");
    const startsAt = normalizeStart(input?.startsAt);
    const durationMin = normalizeDuration(input?.durationMin, DEFAULT_DURATION);
    const priority = normalizePriority(input?.priority);
    const location = text(input?.location, MAX_LOCATION);
    const notes = text(input?.notes, MAX_NOTES);
    const remindAt =
      input?.remindAt === null
        ? null
        : input?.remindAt === undefined
          ? new Date(startsAt.getTime() - REMIND_BEFORE_MS)
          : normalizeStart(input.remindAt);

    const now = new Date();
    const row: typeof scheduleTasks.$inferSelect = {
      id: randomUUID(),
      ownerId: userId,
      title,
      notes,
      location,
      startsAt,
      durationMin,
      remindAt,
      priority,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(scheduleTasks).values(row);
    return this.toDto(row);
  }

  async update(id: string, userId: string, patch: ScheduleTaskPatchInput): Promise<ScheduleTaskDto> {
    const current = await this.owned(id, userId);

    const title = patch?.title !== undefined ? text(patch.title, MAX_TITLE) : current.title;
    if (!title) throw new BadRequestException("任务标题不能为空");
    const notes = patch?.notes !== undefined ? text(patch.notes, MAX_NOTES) : current.notes;
    const location =
      patch?.location !== undefined ? text(patch.location, MAX_LOCATION) : current.location;
    const startsAt = patch?.startsAt !== undefined ? normalizeStart(patch.startsAt) : current.startsAt;
    const durationMin =
      patch?.durationMin !== undefined
        ? normalizeDuration(patch.durationMin, current.durationMin)
        : current.durationMin;
    const priority =
      patch?.priority !== undefined ? normalizePriority(patch.priority, current.priority) : current.priority;
    const status = patch?.status !== undefined ? normalizeStatus(patch.status, current.status) : current.status;
    const remindAt =
      patch?.remindAt === undefined
        ? current.remindAt
        : patch.remindAt === null
          ? null
          : normalizeStart(patch.remindAt);

    await this.db
      .update(scheduleTasks)
      .set({ title, notes, location, startsAt, durationMin, priority, status, remindAt, updatedAt: new Date() })
      .where(eq(scheduleTasks.id, id));

    const [fresh] = await this.db.select().from(scheduleTasks).where(eq(scheduleTasks.id, id));
    return this.toDto(fresh);
  }

  async remove(id: string, userId: string) {
    await this.owned(id, userId);
    await this.db.delete(scheduleTasks).where(eq(scheduleTasks.id, id));
  }

  /** 未来 N 天的待办，供首页摘要与 AI 工具使用 */
  async upcoming(userId: string, days = 7): Promise<ScheduleTaskDto[]> {
    const now = new Date();
    const until = new Date(now.getTime() + Math.max(0, days) * 24 * 3600 * 1000);
    const rows = await this.db
      .select()
      .from(scheduleTasks)
      .where(
        and(
          eq(scheduleTasks.ownerId, userId),
          eq(scheduleTasks.status, "pending"),
          gte(scheduleTasks.startsAt, now),
          lte(scheduleTasks.startsAt, until),
        ),
      )
      .orderBy(asc(scheduleTasks.startsAt));
    return rows.map((r) => this.toDto(r));
  }

  /** AI 工具：按 id 或标题完成任务 */
  async complete(userId: string, idOrTitle: string): Promise<ScheduleTaskDto> {
    const key = idOrTitle.trim();
    if (!key) throw new BadRequestException("缺少任务 id 或标题");
    let row = (
      await this.db
        .select()
        .from(scheduleTasks)
        .where(and(eq(scheduleTasks.id, key), eq(scheduleTasks.ownerId, userId)))
    )[0];
    if (!row) {
      row = (
        await this.db
          .select()
          .from(scheduleTasks)
          .where(and(eq(scheduleTasks.title, key), eq(scheduleTasks.ownerId, userId)))
      )[0];
    }
    if (!row) throw new NotFoundException(`任务「${key}」不存在`);
    return this.update(row.id, userId, { status: "done" });
  }
}
