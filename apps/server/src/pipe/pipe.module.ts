import { Module } from "@nestjs/common";
import { ModelsModule } from "../models/models.module";
import { PipeController } from "./pipe.controller";
import { PipeService } from "./pipe.service";

@Module({
  imports: [ModelsModule],
  controllers: [PipeController],
  providers: [PipeService],
})
export class PipeModule {}
