import { Module } from "@nestjs/common";
import { KbModule } from "../kb/kb.module";
import { NotifyModule } from "../notify/notify.module";
import { BlogController } from "./blog.controller";
import { BlogService } from "./blog.service";

@Module({
  imports: [KbModule, NotifyModule],
  controllers: [BlogController],
  providers: [BlogService],
  exports: [BlogService],
})
export class BlogModule {}
