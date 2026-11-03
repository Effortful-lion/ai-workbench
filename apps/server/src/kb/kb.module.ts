import { Module } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { LlmAdapter } from "../llm/llm.adapter";
import { KbController } from "./kb.controller";
import { KbService } from "./kb.service";
import { EmbeddingService } from "./embedding.service";
import { QdrantService } from "./qdrant.service";

@Module({
  imports: [ChatModule],
  controllers: [KbController],
  providers: [KbService, EmbeddingService, QdrantService, LlmAdapter],
})
export class KbModule {}
