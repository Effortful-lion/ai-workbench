// E2E 触发：通过 Socket.io 发送一条消息，让 PhaseTestAgent 跑完完整 phase 链
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const socketIOpath = path.resolve(
  import.meta.dirname,
  "../node_modules/.pnpm/socket.io-client@4.8.4/node_modules/socket.io-client/dist/socket.io.js",
);
const { io } = require(socketIOpath);

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxZWE5NjJhNS03ZjdkLTQxZTAtODc4My04YmUzYTMxOWI4YTUiLCJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6Im93bmVyIiwiaWF0IjoxNzkzNjExNTE1LCJleHAiOjE3OTM2MTI0MTV9.mhh8Hmd0TRfMole0oeEX-EESfYL4zFG8A9r8lylud3s";
const AGENT_ID = "6a718ba8-188f-4ee5-b97c-75c4b8b9c1e5"; // PhaseTestAgent（调研→总结）

const socket = io("http://localhost:8700/chat", {
  auth: { token: TOKEN },
  transports: ["websocket"],
  timeout: 5000,
});

let done = false;
const timeout = setTimeout(() => {
  if (!done) {
    console.log("\n⏱ 超时 30s，强制退出");
    socket.disconnect();
    process.exit(1);
  }
}, 30000);

socket.on("connect", () => {
  console.log("✅ WS 已连接");
  socket.emit("send", {
    content: "列出当前所有已接入的 LLM 模型",
    agentId: AGENT_ID,
  });
  console.log("📤 已发送 send 事件\n");
});

socket.on("started", (p) => console.log(`🚀 started: model=${p.model.modelName}, agent=${p.agentId ?? "none"}`));
socket.on("delta", (p) => process.stdout.write(p.delta));
socket.on("trace", (ev) => {
  const short = ev.summary.slice(0, 80);
  console.log(`\n[TRACE] ${ev.type}  ${short}`);
});
socket.on("tool", (t) => console.log(`🔧 tool ${t.name} ok=${t.ok} dur=${t.durationMs}ms`));
socket.on("done", (d) => {
  console.log(`\n✅ done! conversationId=${d.conversationId}`);
  clearTimeout(timeout);
  done = true;
  socket.disconnect();
  process.exit(0);
});
socket.on("error", (e) => {
  console.error(`❌ error: ${e.error ?? e}`);
  clearTimeout(timeout);
  done = true;
  socket.disconnect();
  process.exit(1);
});
socket.on("disconnect", () => console.log("\n🔌 disconnected"));

socket.on("connect_error", (e) => {
  console.error(`❌ connect_error: ${e.message}`);
  clearTimeout(timeout);
  process.exit(1);
});
