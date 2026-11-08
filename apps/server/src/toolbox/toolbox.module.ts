import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { ToolboxController } from "./toolbox.controller";
import { ToolboxService } from "./toolbox.service";

@Module({
  imports: [StorageModule],
  controllers: [ToolboxController],
  providers: [ToolboxService],
})
export class ToolboxModule {}
