import { Controller, Delete, Get, Param, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { ChatService } from "./chat.service";

/** 会话历史的 REST 面（WS 负责实时收发，REST 负责读取/管理） */
@Controller("chat")
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePerm("chat:use")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get("conversations")
  list(@CurrentUser() user: AuthUser) {
    return this.chat.listConversations(user.id);
  }

  @Get("conversations/:id/messages")
  messages(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.chat.listMessages(id, user.id);
  }

  @Delete("conversations/:id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.chat.removeConversation(id, user.id).then(() => ({ ok: true }));
  }
}
