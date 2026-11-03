import { Module } from "@nestjs/common";
import { ModelsController } from "./models.controller";
import { ModelsService } from "./models.service";
import { LlmAdapter } from "../llm/llm.adapter";

@Module({
  controllers: [ModelsController],
  providers: [ModelsService, LlmAdapter],
  exports: [ModelsService, LlmAdapter],
})
export class ModelsModule {}
