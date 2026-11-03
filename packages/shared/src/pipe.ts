/** 流水线工厂：SOP 定义 + 运行记录（可视化编排 + 批量调用模型） */

export const PIPE_SOP_STATUSES = ["idle", "running", "paused"] as const;
export type PipeSopStatus = (typeof PIPE_SOP_STATUSES)[number];

export const PIPE_RUN_STATUSES = ["running", "done", "failed"] as const;
export type PipeRunStatus = (typeof PIPE_RUN_STATUSES)[number];

export const PIPE_STEP_STATUSES = ["done", "failed", "skipped"] as const;
export type PipeStepStatus = (typeof PIPE_STEP_STATUSES)[number];

/** SOP 内的一步：名称 + 对该步的指令（缺省时用名称作为指令） */
export interface PipeStepDto {
  id: string;
  name: string;
  instruction: string;
}

export interface PipeStepInput {
  name: string;
  instruction?: string;
}

export interface PipeSopInput {
  name: string;
  description?: string;
  /** 步骤：字符串视为「名称」，对象可带 instruction */
  steps: (string | PipeStepInput)[];
  /** 展示用周期文案，如「每周五 16:00」，本期不落调度器 */
  schedule?: string;
  /** 指定模型 id；缺省按 status=ok 优先挑选 */
  modelId?: string | null;
}

export interface PipeSopPatchInput {
  name?: string;
  description?: string;
  steps?: (string | PipeStepInput)[];
  schedule?: string;
  modelId?: string | null;
  status?: PipeSopStatus;
}

export interface PipeSopDto {
  id: string;
  name: string;
  description: string;
  status: PipeSopStatus;
  schedule: string;
  modelId: string | null;
  modelName: string | null;
  steps: PipeStepDto[];
  stepCount: number;
  runCount: number;
  successCount: number;
  avgDurationMs: number;
  lastRunAt: number | null;
  lastRunStatus: PipeRunStatus | null;
  createdAt: number;
  updatedAt: number;
}

export interface PipeRunStepDto {
  id: string;
  index: number;
  name: string;
  status: PipeStepStatus;
  input: string;
  output: string;
  error: string | null;
  durationMs: number;
}

export interface PipeRunDto {
  id: string;
  sopId: string | null;
  sopName: string;
  /** 本次任务的附加输入 / 主题 */
  input: string;
  /** 最后一步产出，作为整条流水线的结果 */
  output: string;
  error: string | null;
  status: PipeRunStatus;
  stepTotal: number;
  stepDone: number;
  durationMs: number;
  startedAt: number;
  finishedAt: number | null;
  steps: PipeRunStepDto[];
}

export interface PipeDigestDto {
  sops: number;
  active: number;
  paused: number;
  runsToday: number;
  running: number;
  successRate: number;
  failed: number;
  avgDurationMs: number;
  summary: string;
}
