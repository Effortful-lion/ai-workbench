import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { ConversationDto, MessageDto, MessageRole, ToolCallRef } from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { conversations, messages } from "../db/schema";
import { ModelsService } from "../models/models.service";

export interface MessageMeta {
  toolCalls?: ToolCallRef[];
  toolCallId?: string;
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly models: ModelsService,
  ) {}

  private toConversationDto(c: typeof conversations.$inferSelect): ConversationDto {
    return {
      id: c.id,
      title: c.title,
      agentId: c.agentId,
      createdAt: c.createdAt.getTime(),
    };
  }

  private toMessageDto(m: typeof messages.$inferSelect): MessageDto {
    const meta = (m.meta ?? {}) as MessageMeta;
    return {
      id: m.id,
      conversationId: m.conversationId,
      role: m.role as MessageRole,
      content: m.content,
      createdAt: m.createdAt.getTime(),
      ...(meta.toolCallId ? { toolCallId: meta.toolCallId } : {}),
      ...(meta.toolCalls?.length ? { toolCalls: meta.toolCalls } : {}),
    };
  }

  async listConversations(userId: string): Promise<ConversationDto[]> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.createdAt));
    return rows.map((c) => this.toConversationDto(c));
  }

  async createConversation(
    userId: string,
    firstContent: string,
    agentId?: string | null,
  ): Promise<ConversationDto> {
    const row: typeof conversations.$inferSelect = {
      id: randomUUID(),
      userId,
      title: firstContent.trim().replace(/\s+/g, " ").slice(0, 24) || "新会话",
      agentId: agentId ?? null,
      createdAt: new Date(),
    };
    await this.db.insert(conversations).values(row);
    return this.toConversationDto(row);
  }

  /** 校验会话归属，越权访问一律 404（不泄露存在性） */
  async getOwnedConversation(id: string, userId: string): Promise<ConversationDto> {
    const [c] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
    if (!c) throw new NotFoundException("conversation not found");
    return this.toConversationDto(c);
  }

  async listMessages(conversationId: string, userId: string): Promise<MessageDto[]> {
    await this.getOwnedConversation(conversationId, userId);
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
    return rows.map((m) => this.toMessageDto(m));
  }

  async appendMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    meta?: MessageMeta | null,
  ): Promise<MessageDto> {
    const row: typeof messages.$inferSelect = {
      id: randomUUID(),
      conversationId,
      role,
      content,
      meta: meta ?? null,
      createdAt: new Date(),
    };
    await this.db.insert(messages).values(row);
    return this.toMessageDto(row);
  }

  async removeConversation(id: string, userId: string) {
    await this.getOwnedConversation(id, userId);
    await this.db.delete(conversations).where(eq(conversations.id, id));
  }

  /** 挑选对话模型：委托给 ModelsService（单一实现，避免循环依赖） */
  async pickModel(modelId?: string) {
    return this.models.pickModel(modelId);
  }

  /** 取会话的模型上下文（最近 20 条，截断防 token 爆炸）——同时带 toolCallId / toolCalls 供原生 function calling 还原 */
  async buildContext(conversationId: string): Promise<MessageDto[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(20);
    return rows.reverse().map((m) => this.toMessageDto(m));
  }
}
