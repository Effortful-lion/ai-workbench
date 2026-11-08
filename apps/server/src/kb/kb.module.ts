import { Module } from "@nestjs/common";
import { ModelsModule } from "../models/models.module";
import { LlmAdapter } from "../llm/llm.adapter";
import { StorageModule } from "../storage/storage.module";
import { KbController } from "./kb.controller";
import { KbService } from "./kb.service";
import { EmbeddingService } from "./embedding.service";
import { LightRagService } from "./lightrag.service";
import { QdrantService } from "./qdrant.service";

@Module({
  imports: [ModelsModule, StorageModule],
  controllers: [KbController],
  providers: [KbService, EmbeddingService, QdrantService, LightRagService, LlmAdapter],
  exports: [KbService, LightRagService],
})
export class KbModule {}
