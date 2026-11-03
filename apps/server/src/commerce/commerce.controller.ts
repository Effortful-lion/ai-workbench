import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type {
  CommerceAdInput,
  CommerceAdPatchInput,
  CommerceOrderInput,
  CommerceOrderStatus,
  CommercePlanInput,
  CommercePlanPatchInput,
} from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { CommerceService } from "./commerce.service";

@Controller("commerce")
export class CommerceController {
  constructor(private readonly svc: CommerceService) {}

  @Get("digest")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:read")
  digest(@CurrentUser() user: AuthUser) {
    return this.svc.digest(user.id);
  }

  @Post("seed")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:write")
  seed(@CurrentUser() user: AuthUser) {
    return this.svc.seed(user.id);
  }

  @Get("plans")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:read")
  listPlans(@CurrentUser() user: AuthUser) {
    return this.svc.listPlans(user.id);
  }

  @Post("plans")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:write")
  createPlan(@CurrentUser() user: AuthUser, @Body() body: CommercePlanInput) {
    return this.svc.createPlan(user.id, body);
  }

  @Patch("plans/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:write")
  patchPlan(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: CommercePlanPatchInput,
  ) {
    return this.svc.patchPlan(user.id, id, body);
  }

  @Delete("plans/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:write")
  removePlan(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.removePlan(user.id, id).then(() => ({ ok: true }));
  }

  @Get("orders")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:read")
  listOrders(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: string,
    @Query("q") q?: string,
  ) {
    return this.svc.listOrders(user.id, {
      status: status ? (status as CommerceOrderStatus) : undefined,
      q,
    });
  }

  @Post("orders")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:write")
  createOrder(@CurrentUser() user: AuthUser, @Body() body: CommerceOrderInput) {
    return this.svc.createOrder(user.id, body);
  }

  @Post("orders/:id/pay")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:write")
  payOrder(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.payOrder(user.id, id);
  }

  @Post("orders/:id/refund")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:write")
  refundOrder(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.refundOrder(user.id, id);
  }

  @Delete("orders/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:write")
  removeOrder(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.removeOrder(user.id, id).then(() => ({ ok: true }));
  }

  @Get("ads")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:read")
  listAds(@CurrentUser() user: AuthUser) {
    return this.svc.listAds(user.id);
  }

  @Post("ads")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:write")
  createAd(@CurrentUser() user: AuthUser, @Body() body: CommerceAdInput) {
    return this.svc.createAd(user.id, body);
  }

  @Patch("ads/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:write")
  patchAd(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: CommerceAdPatchInput,
  ) {
    return this.svc.patchAd(user.id, id, body);
  }

  @Delete("ads/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("commerce:write")
  removeAd(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.removeAd(user.id, id).then(() => ({ ok: true }));
  }
}
