import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { createReadStream } from "node:fs";
import type { ServerResponse } from "node:http";
import type { MailAccountInput, MailMessageInput, MailMessagePatchInput } from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { MailService } from "./mail.service";

@Controller("mail")
export class MailController {
  constructor(private readonly svc: MailService) {}

  @Get("accounts")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:read")
  listAccounts(@CurrentUser() user: AuthUser) {
    return this.svc.listAccounts(user.id);
  }

  @Post("accounts")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:write")
  createAccount(@CurrentUser() user: AuthUser, @Body() body: MailAccountInput) {
    return this.svc.createAccount(user.id, body);
  }

  /** 保存前试连：不落库，验证 IMAP 登录 + SMTP */
  @Post("accounts/test")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:write")
  testConfig(@Body() body: MailAccountInput) {
    return this.svc.testConfig(body);
  }

  @Patch("accounts/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:write")
  updateAccount(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: MailAccountInput,
  ) {
    return this.svc.updateAccount(user.id, id, body);
  }

  /** 已保存账户的连接测试，回写状态灯 */
  @Post("accounts/:id/test")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:write")
  testAccount(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.testAccount(user.id, id);
  }

  @Delete("accounts/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:write")
  removeAccount(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.removeAccount(user.id, id).then(() => ({ ok: true }));
  }

  @Get("digest")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:read")
  digest(@CurrentUser() user: AuthUser) {
    return this.svc.digest(user.id);
  }

  @Get("messages")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:read")
  listMessages(
    @CurrentUser() user: AuthUser,
    @Query("folder") folder?: string,
    @Query("category") category?: string,
    @Query("accountId") accountId?: string,
    @Query("unread") unread?: string,
    @Query("q") q?: string,
  ) {
    return this.svc.listMessages(user.id, {
      folder: folder as never,
      category: category as never,
      accountId,
      unreadOnly: unread === "1" || unread === "true",
      q,
    });
  }

  @Get("messages/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:read")
  getMessage(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.getMessage(user.id, id);
  }

  /** 附件按 index 下载；二进制不随列表下发 */
  @Get("messages/:id/attachments/:index")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:read")
  async downloadAttachment(
    @Param("id") id: string,
    @Param("index") index: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<StreamableFile> {
    const file = await this.svc.attachmentFile(user.id, id, Number(index));
    const fallback = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    res.setHeader("content-type", file.contentType);
    res.setHeader("content-length", String(file.size));
    res.setHeader(
      "content-disposition",
      `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    return new StreamableFile(createReadStream(file.path));
  }

  @Post("messages")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:write")
  compose(@CurrentUser() user: AuthUser, @Body() body: MailMessageInput) {
    return this.svc.compose(user.id, body);
  }

  /** 收件箱一键已读：清掉全部未读（批量回写 IMAP \Seen） */
  @Post("messages/read-all")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:write")
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.svc.markAllRead(user.id);
  }

  @Post("messages/:id/reply")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:write")
  reply(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: { body?: string }) {
    return this.svc.reply(user.id, id, body?.body);
  }

  @Patch("messages/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:write")
  updateMessage(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: MailMessagePatchInput,
  ) {
    return this.svc.updateMessage(user.id, id, body);
  }

  @Delete("messages/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:write")
  removeMessage(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.removeMessage(user.id, id).then(() => ({ ok: true }));
  }

  @Post("classify")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:write")
  classify(@CurrentUser() user: AuthUser) {
    return this.svc.classify(user.id);
  }

  @Post("sync")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("mail:write")
  sync(@CurrentUser() user: AuthUser) {
    return this.svc.sync(user.id);
  }
}
