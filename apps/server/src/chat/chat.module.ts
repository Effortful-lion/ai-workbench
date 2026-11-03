import { Module, forwardRef } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatGateway } from "./chat.gateway";
import { ChatService } from "./chat.service";
import { TraceService } from "./trace.service";
import { LlmAdapter } from "../llm/llm.adapter";
import { AgentsModule } from "../agents/agents.module";

@Module({
  imports: [forwardRef(() => AgentsModule)],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, LlmAdapter, TraceService],
  exports: [ChatService, TraceService],
})
export class ChatModule {}
