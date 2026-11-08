import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { ModelsModule } from "../models/models.module";
import { GithubController } from "./github.controller";
import { GithubService } from "./github.service";

@Module({
  imports: [DbModule, ModelsModule],
  controllers: [GithubController],
  providers: [GithubService],
  exports: [GithubService],
})
export class GithubModule {}
