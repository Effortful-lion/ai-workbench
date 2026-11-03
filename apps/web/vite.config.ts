import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // 直接指向 shared 源码，跳过 dist 的 CJS/ESM 兼容问题
      "@aiwb/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 8701,
    proxy: {
      "/api": "http://localhost:8700",
      "/socket.io": { target: "http://localhost:8700", ws: true },
    },
  },
});
