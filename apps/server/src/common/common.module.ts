import { Global, Module } from "@nestjs/common";
import { MailerService } from "./mailer.service";
import { WorkspaceOwner } from "./workspace-owner";

/**
 * 全局基础能力：发信、站点主人解析。
 *
 * 之所以要 Global：JwtAuthGuard 被十几个模块各自用作 provider，
 * 而它现在依赖 WorkspaceOwner；只放 AuthModule 会导致其他模块解析不到依赖。
 */
@Global()
@Module({
  providers: [MailerService, WorkspaceOwner],
  exports: [MailerService, WorkspaceOwner],
})
export class CommonModule {}
