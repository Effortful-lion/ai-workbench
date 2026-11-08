import { Module, forwardRef } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatGateway } from "./chat.gateway";
import { ChatService } from "./chat.service";
import { TraceService } from "./trace.service";
import { LlmAdapter } from "../llm/llm.adapter";
import { AgentsModule } from "../agents/agents.module";
import { ModelsModule } from "../models/models.module";
import { CapabilityModule } from "../capability/capability.module";

@Module({
  imports: [forwardRef(() => AgentsModule), ModelsModule, CapabilityModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, LlmAdapter, TraceService],
  exports: [ChatService, TraceService],
})
export class ChatModule {}
