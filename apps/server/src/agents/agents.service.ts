import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_AGENT_BUDGET,
  hasPermission,
  type AgentBudget,
  type AgentDto,
  type AgentPhase,
  type Role,
  type UpsertAgentInput,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { agents } from "../db/schema";
import { ToolRegistry } from "../tools/tool-registry.service";

@Injectable()
export class AgentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: ToolRegistry,
  ) {}

  private toDto(a: typeof agents.$inferSelect): AgentDto {
    const rawPhases = (a.phasesJson ?? []) as AgentPhase[];
    const phases = rawPhases.length ? rawPhases : null;
    const rawBudget = a.budgetJson as Partial<AgentBudget> | null | undefined;
    const budget = rawBudget ? { ...DEFAULT_AGENT_BUDGET, ...rawBudget } : null;
    return {
      id: a.id,
      ownerId: a.ownerId,
      name: a.name,
      personaPrompt: a.personaPrompt,
      tools: a.toolsJson ?? [],
      phases,
      budget,
      createdAt: a.createdAt.getTime(),
    };
  }

  /** 工具子集校验：必须是已注册工具，且不超创建者自身权限（权限即边界） */
  private validateTools(toolNames: string[], role: Role): string[] {
    const names = [...new Set(toolNames)];
    const invalid = names.filter((n) => !this.registry.get(n));
    if (invalid.length) throw new BadRequestException(`未知工具: ${invalid.join(", ")}`);
    const denied = names.filter((n) => !hasPermission(role, this.registry.get(n)!.permission));
    if (denied.length) {
      throw new BadRequestException(`超出你的权限，无法勾选: ${denied.join(", ")}`);
    }
    return names;
  }

  /** 阶段工具子集校验：复用 validateTools，null = 不覆盖 */
  private validatePhaseTools(phases: AgentPhase[], role: Role): void {
    for (const p of phases) {
      if (!p.name?.trim()) throw new BadRequestException("每个阶段必须有 name");
      if (p.tools && p.tools.length) this.validateTools(p.tools, role);
    }
  }

  private normalizeBudget(input?: Partial<AgentBudget> | null): AgentBudget | null {
    if (!input) return null;
    const b = { ...DEFAULT_AGENT_BUDGET, ...input };
    if (b.maxConcurrency < 1 || b.maxConcurrency > 16)
      throw new BadRequestException("budget.maxConcurrency 需为 1–16");
    if (b.maxDepth < 0 || b.maxDepth > 8) throw new BadRequestException("budget.maxDepth 需为 0–8");
    if (b.maxTotalTokens < 1000) throw new BadRequestException("budget.maxTotalTokens 至少 1000");
    if (b.timeoutSec < 5 || b.timeoutSec > 7200) throw new BadRequestException("budget.timeoutSec 需为 5–7200");
    return b;
  }

  async list(ownerId: string): Promise<AgentDto[]> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(eq(agents.ownerId, ownerId))
      .orderBy(desc(agents.createdAt));
    return rows.map((a) => this.toDto(a));
  }

  async create(ownerId: string, role: Role, input: UpsertAgentInput): Promise<AgentDto> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException("name is required");
    const phases = input.phases?.length ? input.phases : null;
    if (phases) this.validatePhaseTools(phases, role);
    const budget = this.normalizeBudget(input.budget);
    const row: typeof agents.$inferSelect = {
      id: randomUUID(),
      ownerId,
      name: name.slice(0, 40),
      personaPrompt: (input.personaPrompt ?? "").slice(0, 4000),
      toolsJson: this.validateTools(input.tools ?? [], role),
      phasesJson: phases ?? [],
      budgetJson: (budget as unknown as Record<string, unknown>) ?? null,
      createdAt: new Date(),
    };
    await this.db.insert(agents).values(row);
    return this.toDto(row);
  }

  async update(
    id: string,
    ownerId: string,
    role: Role,
    input: Partial<UpsertAgentInput>,
  ): Promise<AgentDto> {
    const [a] = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.ownerId, ownerId)));
    if (!a) throw new NotFoundException("agent not found");
    const patch: Partial<typeof agents.$inferInsert> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException("name is required");
      patch.name = name.slice(0, 40);
    }
    if (input.personaPrompt !== undefined) {
      patch.personaPrompt = input.personaPrompt.slice(0, 4000);
    }
    if (input.tools !== undefined) patch.toolsJson = this.validateTools(input.tools, role);
    if (input.phases !== undefined) {
      const phases = input.phases?.length ? input.phases : null;
      if (phases) this.validatePhaseTools(phases, role);
      patch.phasesJson = phases ?? [];
    }
    if (input.budget !== undefined) {
      const nb = this.normalizeBudget(input.budget);
      patch.budgetJson = nb ? (nb as unknown as Record<string, unknown>) : null;
    }
    await this.db.update(agents).set(patch).where(eq(agents.id, id));
    const [fresh] = await this.db.select().from(agents).where(eq(agents.id, id));
    return this.toDto(fresh);
  }

  async remove(id: string, ownerId: string) {
    const [a] = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.ownerId, ownerId)));
    if (!a) throw new NotFoundException("agent not found");
    await this.db.delete(agents).where(eq(agents.id, id));
  }

  /** 对话通道用：按归属取 Agent，越权返回 null（不泄露存在性） */
  async getOwned(id: string, ownerId: string): Promise<AgentDto | null> {
    const [a] = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.ownerId, ownerId)));
    return a ? this.toDto(a) : null;
  }
}
