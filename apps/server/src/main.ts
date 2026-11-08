import "./env";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 简历导入允许直接粘贴长文本（默认 100kb 对中文简历不够）
  app.useBodyParser("json", { limit: "512kb" });
  app.setGlobalPrefix("api");
  app.enableCors({ origin: true, credentials: true });
  const port = Number(process.env.PORT ?? 8700);
  await app.listen(port);
  console.log(`▸ server ready  http://localhost:${port}/api/health`);
}
bootstrap();
