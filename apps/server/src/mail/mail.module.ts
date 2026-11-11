import { Module } from "@nestjs/common";
import { MailController } from "./mail.controller";
import { MailService } from "./mail.service";
import { MailSyncScheduler } from "./mail-sync.scheduler";

@Module({
  controllers: [MailController],
  providers: [MailService, MailSyncScheduler],
})
export class MailModule {}
