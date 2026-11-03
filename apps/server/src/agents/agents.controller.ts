import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from "@nestjs/common";
import type { UpsertAgentInput } from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { AgentsService } from "./agents.service";
import { TraceService } from "../chat/trace.service";

@Controller("agents")
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AgentsController {
  constructor(
    private readonly svc: AgentsService,
    private readonly trace: TraceService,
  ) {}

  @Get()
  @RequirePerm("agents:read")
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user.id);
  }

  @Post()
  @RequirePerm("agents:write")
  create(@CurrentUser() user: AuthUser, @Body() body: UpsertAgentInput) {
    return this.svc.create(user.id, user.role, body);
  }

  @Patch(":id")
  @RequirePerm("agents:write")
  update(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: Partial<UpsertAgentInput>,
  ) {
    return this.svc.update(id, user.id, user.role, body);
  }

  @Delete(":id")
  @RequirePerm("agents:write")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(id, user.id).then(() => ({ ok: true }));
  }

  /* ── Agent Execution History ── */

  /** 按 agentId 查历史执行（前端 Agent 面板） */
  @Get(":id/executions")
  @RequirePerm("agents:read")
  listExecutions(
    @Param("id") id: string,
    @Query("limit") limit = 20,
  ) {
    return this.trace.listByAgent(id, Number(limit));
  }

  /** 按 userId 查最近所有执行（CLI 面板首页 / 全局历史） */
  @Get("executions")
  @RequirePerm("agents:read")
  listMyExecutions(
    @CurrentUser() user: AuthUser,
    @Query("limit") limit = 30,
  ) {
    return this.trace.listByUser(user.id, Number(limit));
  }

  /** 按 conversationId 查最近执行（前端恢复上下文时用） */
  @Get("executions/latest")
  @RequirePerm("agents:read")
  latest(@Query("conversationId") conversationId: string) {
    return this.trace.latestByConversation(conversationId);
  }
}
