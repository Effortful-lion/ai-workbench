import { Module, forwardRef } from "@nestjs/common";
import { AgentsService } from "./agents.service";
import { AgentsController } from "./agents.controller";
import { ChatModule } from "../chat/chat.module";

@Module({
  imports: [forwardRef(() => ChatModule)],
  providers: [AgentsService],
  controllers: [AgentsController],
  exports: [AgentsService],
})
export class AgentsModule {}
