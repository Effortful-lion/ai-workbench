import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { DbModule } from "./db/db.module";
import { AuthModule } from "./auth/auth.module";
import { ModelsModule } from "./models/models.module";
import { ChatModule } from "./chat/chat.module";
import { ToolsModule } from "./tools/tools.module";
import { AgentsModule } from "./agents/agents.module";
import { KbModule } from "./kb/kb.module";
import { BlogModule } from "./blog/blog.module";
import { ResumeModule } from "./resume/resume.module";
import { ContactModule } from "./contact/contact.module";
import { ToolboxModule } from "./toolbox/toolbox.module";
import { ProjectsModule } from "./projects/projects.module";
import { CodeModule } from "./code/code.module";
import { ScheduleModule } from "./schedule/schedule.module";
import { MailModule } from "./mail/mail.module";
import { NotifyModule } from "./notify/notify.module";
import { CommerceModule } from "./commerce/commerce.module";
import { CrmModule } from "./crm/crm.module";
import { PipeModule } from "./pipe/pipe.module";
import { StatsModule } from "./stats/stats.module";
import { StorageModule } from "./storage/storage.module";
import { GithubModule } from "./github/github.module";

@Module({
  imports: [
    DbModule, AuthModule, ToolsModule, ModelsModule, AgentsModule, ChatModule, KbModule, BlogModule, ResumeModule, ContactModule,
    ToolboxModule, ProjectsModule, CodeModule, ScheduleModule, MailModule, NotifyModule, CommerceModule,
    CrmModule,
    PipeModule,
    StatsModule,
    StorageModule,
    GithubModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
