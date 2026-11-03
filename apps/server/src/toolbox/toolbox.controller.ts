import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { createReadStream } from "node:fs";
import type { ToolboxItemInput } from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import {
  MAX_TOOLBOX_FILE_BYTES,
  ToolboxService,
  type FileToolInput,
  type UploadedToolboxFile,
} from "./toolbox.service";

@Controller("toolbox")
export class ToolboxController {
  constructor(private readonly svc: ToolboxService) {}

  @Get("items")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("tools:read")
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user.id);
  }

  /** 链接类工具（JSON） */
  @Post("items")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("tools:write")
  create(@CurrentUser() user: AuthUser, @Body() body: ToolboxItemInput) {
    return this.svc.create(user.id, body);
  }

  /** 文件类工具（multipart：二进制 / 安装包 / 压缩包 / 技能包） */
  @Post("items/upload")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("tools:write")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_TOOLBOX_FILE_BYTES } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedToolboxFile | undefined,
    @Body() body: FileToolInput,
  ) {
    if (!file) throw new BadRequestException("缺少文件字段 file");
    return this.svc.createFile(user.id, body ?? {}, file);
  }

  @Delete("items/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("tools:write")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(id, user.id).then(() => ({ ok: true }));
  }

  @Post("items/:id/use")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("tools:read")
  touch(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.touch(id, user.id);
  }

  /** 文件下载：id 为随机 UUID，公开只读墙也能取，无需登录 */
  @Get("files/:id")
  async download(
    @Param("id") id: string,
    @Res({ passthrough: true }) res: { set(headers: Record<string, string>): unknown },
  ) {
    const f = await this.svc.fileFor(id);
    const fallback = f.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    res.set({
      "content-type": f.mimeType,
      "content-length": String(f.size),
      "content-disposition": `attachment; filename="${fallback || "download"}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "cache-control": "private, max-age=0",
    });
    return new StreamableFile(createReadStream(f.path));
  }

  /** 游客公开只读墙 /t/:username 的数据源 */
  @Get("public/:username")
  listPublic(@Param("username") username: string) {
    return this.svc.listPublic(username);
  }
}
