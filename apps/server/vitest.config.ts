import { defineConfig } from "vitest/config";

/** Vitest 配置：server 端纯逻辑单测。
 *  先在 chat-helpers 这类无副作用的模块上立桩，后续抽 ChatOrchestrator 时即可直接补测试。 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
