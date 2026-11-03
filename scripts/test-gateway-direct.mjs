#!/usr/bin/env node
/**
 * Gateway 核心循环直接测试：绕过 Socket.IO，手动 new 依赖 → 直接调 handleConnection + onSend。
 * 这样能测原生 tool_calls 分流、落库 meta、ToolRegistry.execute、tool role 回灌。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const require = createRequire(import.meta.url);

// 先确认后端活着
const health = await fetch("http://127.0.0.1:8700/api/health").then((r) => r.json()).catch(() => null);
if (!health) { console.error("✗ 后端没启动，先跑 ./scripts/server.sh start"); process.exit(1); }
console.log("▶ 后端就绪", JSON.stringify(health));

// 登录拿 JWT
const cfg = JSON.parse(readFileSync(join(process.env.HOME, ".aiwb/config.json"), "utf8"));
const token = (await fetch(`${cfg.server}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: cfg.username ?? "admin", password: cfg.password ?? "admin" }),
}).then((r) => r.json())).tokens.accessToken;
console.log("▶ token ok");

// 用 Socket.IO v4 协议直接走一次 WebSocket（polling 协议配对问题太多，WebSocket 更简单）
const Ws = globalThis.WebSocket;

// 从 models 表拿 mock model ID
const models = await fetch(`${cfg.server}/api/models`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
const mockModel = models.find((m) => m.endpoint.startsWith("mock://"));
if (!mockModel) { console.error("✗ 没 mock 模型"); process.exit(1); }
console.log(`▶ model ${mockModel.modelName}`);

// 准备 EventSource 结构
const events = [];
let doneReceived = false;

function parseSocketIOPayload(text) {
  // Socket.IO v4 over WebSocket: 40=hello, 42=event, 43=ack, 44=error
  if (text === "40") return { type: "hello" };
  if (text.startsWith("42")) {
    try {
      const payload = JSON.parse(text.slice(2));
      const [eventName, ...rest] = payload;
      return { type: "event", name: eventName, data: rest[0] };
    } catch { return { type: "raw", text }; }
  }
  return { type: "raw", text };
}

// 构造 WebSocket URL
const wsUrl = cfg.server.replace(/^http/, "ws") + "/chat?token=" + encodeURIComponent(token);
console.log(`▶ WS 连接 ${wsUrl.replace(/\/.*token=.*/, "/chat?...")}`);

const ws = new Ws(wsUrl, { handshakeTimeout: 5000 });

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("WS 连接超时")), 5000);
  ws.addEventListener("open", () => { clearTimeout(timer); resolve(); });
  ws.addEventListener("error", (e) => { clearTimeout(timer); reject(e.error || new Error("WS error")); });
});
console.log("▶ WS 已连接");

const sendEvent = (name, data) => {
  ws.send(`42${JSON.stringify([name, data])}`);
};

ws.addEventListener("message", async (ev) => {
  const text = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8");
  // Engine.IO 4.x WS: 消息是 "4" + Socket.IO payload（不用长度前缀，直接 JSON）
  // 但 Socket.IO 4.x over WS 可能也用 "40" hello 和 "42" event
  const trimmed = text.replace(/^\u001e/, ""); // remove Engine.IO separator
  const parsed = parseSocketIOPayload(trimmed);
  if (parsed.type === "hello") {
    console.log("▶ Socket.IO hello");
    // 发送 send 事件
    sendEvent("send", { content: "帮我看看 mail", modelId: mockModel.id });
    console.log("▶ 发送 send");
    return;
  }
  if (parsed.type === "event") {
    const { name, data } = parsed;
    events.push({ name, data });
    switch (name) {
      case "started":
        console.log(`[started] conversation=${data.conversationId}`);
        break;
      case "delta":
        process.stdout.write(data.delta);
        break;
      case "tool":
        console.log(`\n[tool] ${data.name} ok=${data.ok} durationMs=${data.durationMs}`);
        console.log(`       content=${data.message.content?.slice(0, 120)}`);
        console.log(`       toolCallId=${data.message.toolCallId ?? "(无)"}`);
        break;
      case "trace":
        if (["tool.started", "tool.done", "tool.failed", "phase.started", "phase.done", "agent.started", "agent.done", "agent.failed", "budget.hit"].includes(data.type)) {
          console.log(`[trace.${data.type}] ${data.summary}`);
        }
        break;
      case "done":
        console.log(`\n[done] content=${data.message.content?.slice(0, 200)}`);
        console.log(`[done] toolCalls=${JSON.stringify(data.message.toolCalls) ?? "(无)"}`);
        doneReceived = true;
        ws.close();
        break;
      case "error":
        console.error(`\n[error] ${data.error}`);
        ws.close();
        break;
      default:
        console.log(`\n[${name}] ${JSON.stringify(data)?.slice(0, 120)}`);
    }
  }
});

await new Promise((resolve) => {
  const timer = setTimeout(() => { console.error("⏰ 30s 超时"); resolve(); ws.close(); }, 30000);
  ws.addEventListener("close", () => { clearTimeout(timer); resolve(); });
});

// DB meta 验证
const { join: pjoin } = require("node:path");
const DB = require(join(root, "apps/server/node_modules/better-sqlite3"));
const db = new DB(pjoin(root, "data/workbench.db"), { readonly: true });
const rows = db.prepare("SELECT role, substr(content,1,50) as content, meta FROM messages ORDER BY rowid DESC LIMIT 10").all();
console.log("\n── DB 最近 10 条消息 ──");
for (const row of rows) {
  console.log(`  role=${row.role} content="${row.content}..." meta=${row.meta ?? "(null)"}`);
}
db.close();

console.log(`\n✓ 事件总数 ${events.length}  doneReceived=${doneReceived}`);
