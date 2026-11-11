import {
  Body, Controller, Delete, Get, Param, Patch, Post, UseGuards,
} from "@nestjs/common";
import { ModelsService, type UpsertModelInput } from "./models.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";

@Controller("models")
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ModelsController {
  constructor(private readonly svc: ModelsService) {}

  /** 列表同时服务于「模型管理」与「切模型」：写操作仍是 models:write */
  @Get()
  @RequirePerm("models:use")
  list() {
    return this.svc.list();
  }

  @Post()
  @RequirePerm("models:write")
  create(@Body() body: UpsertModelInput) {
    return this.svc.create(body);
  }

  @Patch(":id")
  @RequirePerm("models:write")
  update(@Param("id") id: string, @Body() body: Partial<UpsertModelInput>) {
    return this.svc.update(id, body);
  }

  @Delete(":id")
  @RequirePerm("models:write")
  remove(@Param("id") id: string) {
    return this.svc.remove(id);
  }

  @Post(":id/default")
  @RequirePerm("models:write")
  setDefault(@Param("id") id: string) {
    return this.svc.setDefault(id);
  }

  @Post(":id/test")
  @RequirePerm("models:write")
  test(@Param("id") id: string, @Body() body: { prompt?: string }) {
    return this.svc.test(id, body?.prompt);
  }
}
