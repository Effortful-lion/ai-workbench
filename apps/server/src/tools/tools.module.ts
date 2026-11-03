import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { ToolRegistry } from "./tool-registry.service";
import { OperationToolsService } from "./operation-tools.service";
import { CustomToolsService } from "./custom-tools.service";
import { WebTools } from "./web.tools";
import { ToolsController } from "./tools.controller";

/** Tool Registry 全局可见：任何模块的 provider 都可以用 @RegisterTool 注册能力 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [ToolRegistry, OperationToolsService, CustomToolsService, WebTools],
  controllers: [ToolsController],
  exports: [ToolRegistry],
})
export class ToolsModule {}
