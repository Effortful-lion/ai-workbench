import { Module } from "@nestjs/common";
import { KbModule } from "../kb/kb.module";
import { ModelsModule } from "../models/models.module";
import { LlmAdapter } from "../llm/llm.adapter";
import { CapabilityService } from "./capability.service";

/** 能力路由与检索：依赖 KB（能力手册存储/检索）与 Models（路由用模型挑选） */
@Module({
  imports: [KbModule, ModelsModule],
  providers: [CapabilityService, LlmAdapter],
  exports: [CapabilityService],
})
export class CapabilityModule {}
