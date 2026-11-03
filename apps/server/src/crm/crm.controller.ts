import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { CrmCustomerInput, CrmCustomerPatchInput, CrmFollowUpInput } from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { CrmService } from "./crm.service";

@Controller("crm")
export class CrmController {
  constructor(private readonly svc: CrmService) {}

  @Get("digest")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("crm:read")
  digest(@CurrentUser() user: AuthUser) {
    return this.svc.digest(user.id);
  }

  @Post("seed")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("crm:write")
  seed(@CurrentUser() user: AuthUser) {
    return this.svc.seed(user.id);
  }

  @Get("customers")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("crm:read")
  listCustomers(
    @CurrentUser() user: AuthUser,
    @Query("stage") stage?: string,
    @Query("q") q?: string,
    @Query("stale") stale?: string,
  ) {
    return this.svc.listCustomers(user.id, {
      stage,
      q,
      stale: stale === "1" || stale === "true",
    });
  }

  @Post("customers")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("crm:write")
  createCustomer(@CurrentUser() user: AuthUser, @Body() body: CrmCustomerInput) {
    return this.svc.createCustomer(user.id, body);
  }

  @Get("customers/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("crm:read")
  getCustomer(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.getCustomer(user.id, id);
  }

  @Patch("customers/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("crm:write")
  patchCustomer(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: CrmCustomerPatchInput,
  ) {
    return this.svc.patchCustomer(user.id, id, body);
  }

  @Delete("customers/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("crm:write")
  removeCustomer(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.removeCustomer(user.id, id).then(() => ({ ok: true }));
  }

  @Get("customers/:id/followups")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("crm:read")
  listFollowUps(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.listFollowUps(user.id, id);
  }

  @Post("customers/:id/followups")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("crm:write")
  addFollowUp(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: CrmFollowUpInput,
  ) {
    return this.svc.addFollowUp(user.id, id, body);
  }

  @Delete("customers/:id/followups/:followUpId")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("crm:write")
  removeFollowUp(
    @Param("id") id: string,
    @Param("followUpId") followUpId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.removeFollowUp(user.id, id, followUpId).then(() => ({ ok: true }));
  }
}
