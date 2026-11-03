import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import {
  extractResumeText,
  MAX_UPLOAD_BYTES,
  type UploadedResumeFile,
} from "./resume.extract";
import { ResumeService } from "./resume.service";

@Controller("resume")
export class ResumeController {
  constructor(private readonly svc: ResumeService) {}

  /** 本人档案卡（登录可见） */
  @Get("me")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("me:read")
  getMe(@CurrentUser() user: AuthUser) {
    return this.svc.getOwn(user);
  }

  /** 仅 owner 可写；member 的简历按原型 ACL 保持只读 */
  @Put("me")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("me:write")
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.svc.update(user.id, body);
  }

  /** 上传简历文件（pdf/docx/txt/md）→ 解析成档案卡结构，不落库 */
  @Post("import")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("me:write")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async importFile(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedResumeFile | undefined,
  ) {
    if (!file) throw new BadRequestException("缺少文件字段 file");
    const { text, source } = await extractResumeText(file);
    return this.svc.parseImport(text, source, user.username);
  }

  /** 直接粘贴文本 → 解析成档案卡结构，不落库 */
  @Post("parse")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("me:write")
  parseText(@CurrentUser() user: AuthUser, @Body() body: { text?: unknown }) {
    const text = typeof body?.text === "string" ? body.text : "";
    if (!text.trim()) throw new BadRequestException("text 不能为空");
    return this.svc.parseImport(text, "text", user.username);
  }

  /** 公开只读页 /p/:username 的数据源，不要求登录 */
  @Get("public/:username")
  getPublic(@Param("username") username: string) {
    return this.svc.getPublic(username);
  }
}
