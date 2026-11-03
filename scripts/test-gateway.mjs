#!/usr/bin/env node
/**
 * Gateway 原生 function calling 端到端（用 Socket.IO 官方客户端）。
 *   node scripts/test-gateway.mjs mock
 *   node scripts/test-gateway.mjs doubao
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const require = createRequire(import.meta.url);

// Socket.IO 4.x 客户端
const { io } = require(join(root, "apps/server/node_modules/socket.io-client/dist/socket.io.js"));

const mode = process.argv[2] ?? "mock";
const prompt = process.argv[3] ?? (mode === "mock" ? "帮我看看 mail" : "帮我看看 mail");

const cfg = JSON.parse(readFileSync(join(process.env.HOME, ".aiwb/config.json"), "utf8"));
const baseUrl = cfg.server.replace(/\/+$/, "");
console.log(`▶ ${baseUrl}/chat  mode=${mode}  prompt="${prompt}"`);

const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: cfg.username ?? "admin", password: cfg.password ?? "admin" }),
});
const loginData = await loginRes.json();
const token = loginData.tokens.accessToken;
console.log(`▶ token ${token.slice(0, 16)}...`);

const models = await fetch(`${baseUrl}/api/models`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
let modelId;
if (mode === "mock") modelId = models.find((m) => m.endpoint.startsWith("mock://"))?.id;
else modelId = models.find((m) => m.provider === "volces-ark" && m.status === "ok")?.id;
if (!modelId) { console.error(`✗ 没 ${mode} 模型`); process.exit(1); }
console.log(`▶ model ${models.find((m) => m.id === modelId).modelName}\n`);

// Socket.IO 连接
const socket = io(`${baseUrl}/chat`, {
  auth: { token },
  transports: ["websocket"],
  timeout: 5000,
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("WS 连接超时")), 5000);
  socket.on("connect", () => { clearTimeout(timer); resolve(); });
  socket.on("connect_error", (e) => { clearTimeout(timer); reject(new Error(e.message || "connect_error")); });
});
console.log("▶ 已连接\n");

socket.emit("send", { content: prompt, modelId });
console.log("▶ 发送 send 事件");

await new Promise((resolve) => {
  const timer = setTimeout(() => { console.error("⏰ 30s 超时"); socket.close(); resolve(); }, 30000);

  socket.on("started", (p) => console.log(`[started] conversation=${p.conversationId} model=${p.model.modelName}`));
  socket.on("assistant", (p) => {
    console.log(`[assistant] role=${p.message.role} content=${p.message.content?.slice(0, 100)} toolCalls=${p.message.toolCalls?.length ?? 0}`);
    if (p.message.toolCalls?.length) {
      for (const tc of p.message.toolCalls) console.log(`  ├─ tc ${tc.id} ${tc.name} args=${tc.arguments?.slice(0, 80)}`);
    }
  });
  socket.on("delta", (p) => process.stdout.write(p.delta));
  socket.on("tool", (p) => {
    console.log(`\n[tool] ${p.name} ok=${p.ok} durationMs=${p.durationMs}`);
    console.log(`       content=${p.message.content?.slice(0, 120)}`);
    console.log(`       toolCallId=${p.message.toolCallId ?? "(无)"}`);
  });
  socket.on("trace", (p) => {
    if (["tool.started", "tool.done", "tool.failed", "phase.started", "phase.done", "agent.started", "agent.done", "agent.failed", "budget.hit"].includes(p.type)) {
      console.log(`[trace.${p.type}] ${p.summary}`);
    }
  });
  socket.on("done", async (p) => {
    console.log(`\n[done] content=${p.message.content?.slice(0, 200)}`);
    console.log(`[done] toolCalls=${JSON.stringify(p.message.toolCalls) ?? "(无)"}`);

    // 查 DB meta
    const DB = require(join(root, "apps/server/node_modules/better-sqlite3"));
    const db = new DB(join(root, "data/workbench.db"), { readonly: true });
    const rows = db.prepare("SELECT role, substr(content,1,50) as content, meta FROM messages ORDER BY rowid DESC LIMIT 10").all();
    console.log("\n── DB 最近 10 条 ──");
    for (const row of rows) console.log(`  role=${row.role} content="${row.content}..." meta=${row.meta ?? "(null)"}`);
    db.close();

    socket.close();
    clearTimeout(timer);
    resolve();
  });
  socket.on("error", (p) => { console.error(`\n[error] ${p.error}`); socket.close(); resolve(); });
});

console.log("\n✓ 完成");
