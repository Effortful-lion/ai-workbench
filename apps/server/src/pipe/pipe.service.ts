import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  PipeDigestDto,
  PipeRunDto,
  PipeRunStatus,
  PipeRunStepDto,
  PipeSopDto,
  PipeSopInput,
  PipeSopPatchInput,
  PipeSopStatus,
  PipeStepInput,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { models, pipeRunSteps, pipeRuns, pipeSops } from "../db/schema";
import { LlmAdapter } from "../llm/llm.adapter";
import { decrypt } from "../common/crypto";

const MAX_NAME = 40;
const MAX_DESC = 200;
const MAX_STEP = 40;
const MAX_INSTRUCTION = 300;
const MAX_SCHEDULE = 40;
const MAX_INPUT = 1000;
const MAX_OUTPUT = 8000;
const MAX_STEPS = 12;
const MAX_QUERY = 80;
const STEP_TIMEOUT = 60_000;

type SopRow = typeof pipeSops.$inferSelect;
type RunRow = typeof pipeRuns.$inferSelect;
type RunStepRow = typeof pipeRunSteps.$inferSelect;

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function normalizeSopStatus(v: unknown, fallback: PipeSopStatus = "idle"): PipeSopStatus {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  const map: Record<string, PipeSopStatus> = {
    idle: "idle",
    "空闲": "idle",
    running: "running",
    "运行中": "running",
    paused: "paused",
    pause: "paused",
    "已暂停": "paused",
  };
  const st = map[s];
  if (!st) throw new BadRequestException("status 仅支持 idle / running / paused");
  return st;
}

/** 把字符串 / 对象混合的步骤输入归一化为带 id 的步骤 */
function buildSteps(input: unknown): { id: string; name: string; instruction: string }[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new BadRequestException("至少需要一个步骤");
  }
  if (input.length > MAX_STEPS) throw new BadRequestException(`步骤数不能超过 ${MAX_STEPS}`);
  return input.map((raw, i) => {
    if (typeof raw === "string") {
      const name = text(raw, MAX_STEP);
      if (!name) throw new BadRequestException(`第 ${i + 1} 步缺少名称`);
      return { id: randomUUID(), name, instruction: "" };
    }
    const step = raw as PipeStepInput;
    const name = text(step?.name, MAX_STEP);
    if (!name) throw new BadRequestException(`第 ${i + 1} 步缺少名称`);
    return { id: randomUUID(), name, instruction: text(step?.instruction, MAX_INSTRUCTION) };
  });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m${s}s`;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

interface SopStats {
  runCount: number;
  successCount: number;
  avgDurationMs: number;
  lastRunAt: number | null;
  lastRunStatus: PipeRunStatus | null;
}

const EMPTY_STATS: SopStats = {
  runCount: 0,
  successCount: 0,
  avgDurationMs: 0,
  lastRunAt: null,
  lastRunStatus: null,
};

function statsOf(rows: { status: PipeRunStatus; durationMs: number; startedAt: Date }[]): SopStats {
  if (rows.length === 0) return EMPTY_STATS;
  const done = rows.filter((r) => r.status === "done");
  const avg =
    done.length > 0 ? Math.round(done.reduce((sum, r) => sum + r.durationMs, 0) / done.length) : 0;
  return {
    runCount: rows.length,
    successCount: done.length,
    avgDurationMs: avg,
    lastRunAt: rows[0].startedAt.getTime(),
    lastRunStatus: rows[0].status,
  };
}

@Injectable()
export class PipeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llm: LlmAdapter,
  ) {}

  private toStepDto(row: { id: string; name: string; instruction: string }) {
    return { id: row.id, name: row.name, instruction: row.instruction };
  }

  private toSopDto(row: SopRow, modelName: string | null, stats: SopStats): PipeSopDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      schedule: row.schedule,
      modelId: row.modelId,
      modelName,
      steps: row.stepsJson.map((s) => this.toStepDto(s)),
      stepCount: row.stepsJson.length,
      runCount: stats.runCount,
      successCount: stats.successCount,
      avgDurationMs: stats.avgDurationMs,
      lastRunAt: stats.lastRunAt,
      lastRunStatus: stats.lastRunStatus,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  private toRunStepDto(row: RunStepRow): PipeRunStepDto {
    return {
      id: row.id,
      index: row.stepIndex,
      name: row.name,
      status: row.status,
      input: row.input,
      output: row.output,
      error: row.error,
      durationMs: row.durationMs,
    };
  }

  private toRunDto(row: RunRow, steps: RunStepRow[]): PipeRunDto {
    return {
      id: row.id,
      sopId: row.sopId,
      sopName: row.sopName,
      input: row.input,
      output: row.output,
      error: row.error,
      status: row.status,
      stepTotal: row.stepTotal,
      stepDone: row.stepDone,
      durationMs: row.durationMs,
      startedAt: row.startedAt.getTime(),
      finishedAt: row.finishedAt?.getTime() ?? null,
      steps: steps
        .filter((s) => s.runId === row.id)
        .sort((a, b) => a.stepIndex - b.stepIndex)
        .map((s) => this.toRunStepDto(s)),
    };
  }

  private async modelNameMap(): Promise<Map<string, string>> {
    const rows = await this.db.select({ id: models.id, modelName: models.modelName }).from(models);
    return new Map(rows.map((m) => [m.id, m.modelName]));
  }

  async listSops(userId: string, filter: { q?: string } = {}): Promise<PipeSopDto[]> {
    const [rows, runRows, names] = await Promise.all([
      this.db.select().from(pipeSops).where(eq(pipeSops.ownerId, userId)).orderBy(desc(pipeSops.updatedAt)),
      this.db
        .select({
          sopId: pipeRuns.sopId,
          status: pipeRuns.status,
          durationMs: pipeRuns.durationMs,
          startedAt: pipeRuns.startedAt,
        })
        .from(pipeRuns)
        .where(eq(pipeRuns.ownerId, userId))
        .orderBy(desc(pipeRuns.startedAt)),
      this.modelNameMap(),
    ]);

    const grouped = new Map<string, typeof runRows>();
    for (const r of runRows) {
      if (!r.sopId) continue;
      const list = grouped.get(r.sopId);
      if (list) list.push(r);
      else grouped.set(r.sopId, [r]);
    }

    let list = rows.map((row) =>
      this.toSopDto(row, row.modelId ? names.get(row.modelId) ?? null : null, statsOf(grouped.get(row.id) ?? [])),
    );

    const q = text(filter.q, MAX_QUERY).toLowerCase();
    if (q) {
      list = list.filter((s) =>
        `${s.name}\n${s.description}\n${s.steps.map((x) => `${x.name} ${x.instruction}`).join("\n")}`
          .toLowerCase()
          .includes(q),
      );
    }
    return list;
  }

  private async ownedSop(userId: string, id: string): Promise<SopRow> {
    const [row] = await this.db
      .select()
      .from(pipeSops)
      .where(and(eq(pipeSops.id, id), eq(pipeSops.ownerId, userId)));
    if (!row) throw new NotFoundException("SOP 不存在");
    return row;
  }

  async getSop(userId: string, id: string): Promise<PipeSopDto> {
    const row = await this.ownedSop(userId, id);
    const [names, runRows] = await Promise.all([
      this.modelNameMap(),
      this.db
        .select({
          status: pipeRuns.status,
          durationMs: pipeRuns.durationMs,
          startedAt: pipeRuns.startedAt,
        })
        .from(pipeRuns)
        .where(and(eq(pipeRuns.ownerId, userId), eq(pipeRuns.sopId, id)))
        .orderBy(desc(pipeRuns.startedAt)),
    ]);
    return this.toSopDto(
      row,
      row.modelId ? names.get(row.modelId) ?? null : null,
      statsOf(runRows),
    );
  }

  private async assertModel(modelId: string | null) {
    if (!modelId) return null;
    const [row] = await this.db.select().from(models).where(eq(models.id, modelId));
    if (!row) throw new BadRequestException("指定模型不存在");
    return row;
  }

  async createSop(userId: string, input: PipeSopInput): Promise<PipeSopDto> {
    const name = text(input?.name, MAX_NAME);
    if (!name) throw new BadRequestException("SOP 名称不能为空");
    const modelId = text(input?.modelId, 64) || null;
    await this.assertModel(modelId);

    const now = new Date();
    const row: SopRow = {
      id: randomUUID(),
      ownerId: userId,
      name,
      description: text(input?.description, MAX_DESC),
      status: "idle",
      schedule: text(input?.schedule, MAX_SCHEDULE),
      modelId,
      stepsJson: buildSteps(input?.steps),
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(pipeSops).values(row);
    return this.getSop(userId, row.id);
  }

  async patchSop(userId: string, id: string, patch: PipeSopPatchInput): Promise<PipeSopDto> {
    const row = await this.ownedSop(userId, id);
    if (row.status === "running") throw new BadRequestException("SOP 正在运行，暂不能修改");

    const nextStatus =
      patch?.status === undefined ? row.status : normalizeSopStatus(patch.status, row.status);
    if (nextStatus === "running") throw new BadRequestException("运行状态由执行器维护");

    const modelId =
      patch?.modelId === undefined
        ? row.modelId
        : text(patch.modelId, 64) || null;
    await this.assertModel(modelId);

    await this.db
      .update(pipeSops)
      .set({
        name: patch?.name === undefined ? row.name : text(patch.name, MAX_NAME) || row.name,
        description:
          patch?.description === undefined ? row.description : text(patch.description, MAX_DESC),
        stepsJson: patch?.steps === undefined ? row.stepsJson : buildSteps(patch.steps),
        schedule: patch?.schedule === undefined ? row.schedule : text(patch.schedule, MAX_SCHEDULE),
        modelId,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(pipeSops.id, id));
    return this.getSop(userId, id);
  }

  async removeSop(userId: string, id: string) {
    const row = await this.ownedSop(userId, id);
    if (row.status === "running") throw new BadRequestException("SOP 正在运行，暂不能删除");
    await this.db.delete(pipeSops).where(eq(pipeSops.id, row.id));
  }

  /** 挑选执行模型：SOP 指定优先，否则 status=ok 的第一个，再退到任意模型 */
  private async pickModel(sop: SopRow) {
    const rows = await this.db.select().from(models);
    const pick =
      (sop.modelId ? rows.find((m) => m.id === sop.modelId) : undefined) ??
      rows.find((m) => m.status === "ok") ??
      rows[0];
    if (!pick) throw new BadRequestException("尚未配置模型 — 先到 ~/models 接入一个模型");
    const meta = (pick.metaJson as { temperature?: number | null; topK?: number | null } | null) ?? null;
    return {
      endpoint: pick.endpoint,
      apiKey: pick.apiKeyEnc ? decrypt(pick.apiKeyEnc) : null,
      modelName: pick.modelName,
      provider: pick.provider,
      temperature: meta?.temperature,
      topK: meta?.topK,
    };
  }

  private buildStepPrompt(sop: SopRow, stepName: string, instruction: string, index: number, input: string, prior: string): string {
    const parts = [`SOP：${sop.name}`];
    if (sop.description) parts.push(`SOP 说明：${sop.description}`);
    if (input) parts.push(`本次输入：${input}`);
    if (prior) parts.push(`前序步骤产出：\n${prior}`);
    parts.push(`当前步骤 ${index + 1}/${sop.stepsJson.length}：${stepName}`);
    parts.push(`执行要求：${instruction || "围绕本步骤名完成产出"}`);
    return parts.join("\n\n");
  }

  private async callModel(
    model: {
      endpoint: string;
      apiKey: string | null;
      modelName: string;
      provider: string;
      temperature?: number | null;
      topK?: number | null;
    },
    stepName: string,
    prompt: string,
  ): Promise<string> {
    // mock:// 模型没有真实推理能力，用带标记的占位产出，避免把 pong 当业务结果
    if (model.endpoint.startsWith("mock://")) {
      return `[mock] 步骤「${stepName}」已完成 · 当前为 mock 模型占位产出，接入真实模型后替换`;
    }
    const r = await this.llm.chat({
      endpoint: model.endpoint,
      apiKey: model.apiKey,
      model: model.modelName,
      temperature: model.temperature,
      topK: model.topK,
      messages: [
        {
          role: "system",
          content: "你是内容生产流水线中的单步执行器，只输出本步骤需要的产出，不要复述指令。",
        },
        { role: "user", content: prompt },
      ],
      timeoutMs: STEP_TIMEOUT,
    });
    const out = r.content.trim();
    if (!out) throw new Error("模型返回空内容");
    return out.slice(0, MAX_OUTPUT);
  }

  /** 顺序执行 SOP 的每一步，失败即中断并把剩余步骤标记 skipped */
  async runSop(userId: string, sopId: string, rawInput?: string): Promise<PipeRunDto> {
    const sop = await this.ownedSop(userId, sopId);
    if (sop.status === "running") throw new BadRequestException("该 SOP 正在运行");
    if (sop.status === "paused") throw new BadRequestException("SOP 已暂停，先恢复再运行");
    if (sop.stepsJson.length === 0) throw new BadRequestException("SOP 没有可执行步骤");

    const input = text(rawInput, MAX_INPUT);
    const model = await this.pickModel(sop);
    const startedAt = new Date();
    const runId = randomUUID();

    await this.db.insert(pipeRuns).values({
      id: runId,
      ownerId: userId,
      sopId: sop.id,
      sopName: sop.name,
      input,
      output: "",
      error: null,
      status: "running",
      stepTotal: sop.stepsJson.length,
      stepDone: 0,
      durationMs: 0,
      startedAt,
      finishedAt: null,
    });
    await this.db
      .update(pipeSops)
      .set({ status: "running", updatedAt: startedAt })
      .where(eq(pipeSops.id, sop.id));

    const t0 = Date.now();
    let prior = "";
    let stepDone = 0;
    let lastOutput = "";
    let failure: string | null = null;

    for (const [i, step] of sop.stepsJson.entries()) {
      const stepStart = Date.now();
      const stepInput = this.buildStepPrompt(sop, step.name, step.instruction, i, input, prior);
      const stepId = randomUUID();

      if (failure) {
        await this.db.insert(pipeRunSteps).values({
          id: stepId,
          runId,
          stepIndex: i,
          name: step.name,
          status: "skipped",
          input: stepInput,
          output: "",
          error: null,
          durationMs: 0,
        });
        continue;
      }

      try {
        const out = await this.callModel(model, step.name, stepInput);
        await this.db.insert(pipeRunSteps).values({
          id: stepId,
          runId,
          stepIndex: i,
          name: step.name,
          status: "done",
          input: stepInput,
          output: out,
          error: null,
          durationMs: Date.now() - stepStart,
        });
        stepDone += 1;
        prior = out.slice(-3000);
        lastOutput = out;
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
        await this.db.insert(pipeRunSteps).values({
          id: stepId,
          runId,
          stepIndex: i,
          name: step.name,
          status: "failed",
          input: stepInput,
          output: "",
          error: failure,
          durationMs: Date.now() - stepStart,
        });
      }
    }

    const finishedAt = new Date();
    await this.db
      .update(pipeRuns)
      .set({
        status: failure ? "failed" : "done",
        output: lastOutput,
        error: failure,
        stepDone,
        durationMs: Date.now() - t0,
        finishedAt,
      })
      .where(eq(pipeRuns.id, runId));
    await this.db
      .update(pipeSops)
      .set({ status: "idle", updatedAt: finishedAt })
      .where(eq(pipeSops.id, sop.id));

    return this.getRun(userId, runId);
  }

  async getRun(userId: string, id: string): Promise<PipeRunDto> {
    const [row] = await this.db
      .select()
      .from(pipeRuns)
      .where(and(eq(pipeRuns.id, id), eq(pipeRuns.ownerId, userId)));
    if (!row) throw new NotFoundException("运行记录不存在");
    const steps = await this.db
      .select()
      .from(pipeRunSteps)
      .where(eq(pipeRunSteps.runId, id))
      .orderBy(pipeRunSteps.stepIndex);
    return this.toRunDto(row, steps);
  }

  async listRuns(userId: string, limitInput?: number): Promise<PipeRunDto[]> {
    const limit = Math.min(50, Math.max(1, Math.round(Number(limitInput) || 20)));
    const rows = await this.db
      .select()
      .from(pipeRuns)
      .where(eq(pipeRuns.ownerId, userId))
      .orderBy(desc(pipeRuns.startedAt))
      .limit(limit);
    if (rows.length === 0) return [];

    const steps = await this.db
      .select()
      .from(pipeRunSteps)
      .where(inArray(pipeRunSteps.runId, rows.map((r) => r.id)))
      .orderBy(pipeRunSteps.stepIndex);
    return rows.map((r) => this.toRunDto(r, steps));
  }

  async retryRun(userId: string, runId: string): Promise<PipeRunDto> {
    const run = await this.getRun(userId, runId);
    if (!run.sopId) throw new BadRequestException("原 SOP 已删除，无法重试");
    return this.runSop(userId, run.sopId, run.input);
  }

  /** AI 工具：按 id / 名称关键词定位 SOP */
  async findSopByKey(userId: string, key: string): Promise<PipeSopDto> {
    const q = key.trim();
    if (!q) throw new BadRequestException("缺少 SOP id 或关键词");
    const list = await this.listSops(userId);
    const found = list.find((s) => s.id === q) ?? list.find((s) => s.name.includes(q));
    if (!found) throw new NotFoundException(`未找到 SOP「${q}」`);
    return found;
  }

  async digest(userId: string): Promise<PipeDigestDto> {
    const [sops, runRows] = await Promise.all([
      this.listSops(userId),
      this.db
        .select({
          status: pipeRuns.status,
          durationMs: pipeRuns.durationMs,
          startedAt: pipeRuns.startedAt,
        })
        .from(pipeRuns)
        .where(eq(pipeRuns.ownerId, userId)),
    ]);

    const todayStart = startOfToday();
    const today = runRows.filter((r) => r.startedAt.getTime() >= todayStart);
    const done = today.filter((r) => r.status === "done");
    const failed = today.filter((r) => r.status === "failed");
    const finished = done.length + failed.length;
    const successRate = finished > 0 ? Math.round((done.length / finished) * 100) : 0;
    const avgDurationMs =
      done.length > 0 ? Math.round(done.reduce((sum, r) => sum + r.durationMs, 0) / done.length) : 0;

    const active = sops.filter((s) => s.status !== "paused").length;
    const paused = sops.filter((s) => s.status === "paused").length;
    const running = sops.filter((s) => s.status === "running").length;

    const summary =
      sops.length > 0
        ? `SOP = 可视化编排 + 批量调用 Agent · 今日已跑 ${today.length} 次 · 成功率 ${successRate}% · 均耗时 ${fmtDuration(avgDurationMs)}`
        : "暂无 SOP — 新建一条 SOP 编排生产链路";

    return {
      sops: sops.length,
      active,
      paused,
      runsToday: today.length,
      running,
      successRate,
      failed: failed.length,
      avgDurationMs,
      summary,
    };
  }

}
