#!/usr/bin/env node
/**
 * 原生 function calling 端到端验证：原生 WebSocket + Socket.IO v4 协议握手。
 * 不走 socket.io-client，直接用 Node 全局 WebSocket。
 *
 *   node scripts/test-native-fc.mjs mock              # mock:// 模型
 *   node scripts/test-native-fc.mjs doubao            # 真实豆包
 *   node scripts/test-native-fc.mjs doubao "查一下我的收件箱"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Node 21+ 有全局 WebSocket
const Ws = globalThis.WebSocket;

const mode = process.argv[2] ?? "mock";
const prompt = process.argv[3] ?? (mode === "mock" ? "帮我看看 mail" : "帮我看看 mail");

const cfg = JSON.parse(readFileSync(join(process.env.HOME, ".aiwb/config.json"), "utf8"));
const baseUrl = cfg.server.replace(/\/+$/, "");
console.log(`▶ 连接 ${baseUrl}/chat  mode=${mode}  prompt="${prompt}"`);

// 拿 token
const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: cfg.username ?? "admin", password: cfg.password ?? "admin" }),
});
const loginData = await loginRes.json();
const token = loginData.accessToken ?? cfg.token;
console.log(`▶ token ${token.slice(0, 16)}...`);

// 选模型
const modelsRes = await fetch(`${baseUrl}/api/models`, { headers: { authorization: `Bearer ${token}` } });
const models = await modelsRes.json();
let modelId;
if (mode === "mock") {
  modelId = models.find((m) => m.endpoint.startsWith("mock://"))?.id;
} else {
  modelId = models.find((m) => m.provider === "volces-ark" && m.status === "ok")?.id;
}
if (!modelId) { console.error(`✗ 没找到 ${mode} 模型`); process.exit(1); }
const model = models.find((m) => m.id === modelId);
console.log(`▶ 模型 ${model.modelName} (${model.provider}, ${model.endpoint})\n`);

// Socket.IO v4 协议：先 GET /chat?EIO=4&transport=websocket&token=xxx → 拿到 sid → WS 握手
const handshakeUrl = `${baseUrl.replace(/^http/, "ws")}/chat?EIO=4&transport=websocket&token=${encodeURIComponent(token)}`;

const ws = new Ws(handshakeUrl, { headers: { authorization: `Bearer ${token}` } });

const connectTimer = setTimeout(() => {
  console.error("✗ WS 连接超时");
  process.exit(1);
}, 5000);

let connected = false;
let eventCount = 0;
let done = false;

ws.addEventListener("open", () => {
  clearTimeout(connectTimer);
  connected = true;
});

ws.addEventListener("message", (e) => {
  const text = typeof e.data === "string" ? e.data : Buffer.from(e.data).toString("utf8");
  // Engine.IO packet type: 0=open, 1=close, 2=ping, 3=pong, 4=message
  // Socket.IO: 40=hello, 42=event, 43=ack, 44=connect_error, 41=disconnect
  if (text.startsWith("0")) {
    // Engine.IO open，服务端 sid
    console.log(`▶ Engine.IO open: ${text.slice(0, 120)}`);
    // 发 Socket.IO 握手
    ws.send("40");
    return;
  }
  if (text.startsWith("40")) {
    // Socket.IO hello，现在可以发事件了
    console.log(`▶ Socket.IO hello  ${text.slice(0, 80)}\n`);
    ws.send(`42["send",${JSON.stringify({ content: prompt, modelId })}]`);
    return;
  }
  if (text.startsWith("43")) {
    // ack
    return;
  }
  if (text.startsWith("44")) {
    // connect error
    console.error(`✗ Socket.IO connect error: ${text}`);
    process.exit(1);
    return;
  }
  if (text.startsWith("42")) {
    // event: 42["eventName", data...]
    eventCount++;
    const payload = JSON.parse(text.slice(2));
    const [eventName, ...rest] = payload;
    handleEvent(eventName, rest[0]);
    return;
  }
  if (text === "1" || text === "2" || text === "3") return; // Engine.IO close/ping/pong
  if (text.startsWith("41")) { console.log("▶ Socket.IO disconnect"); return; }
  console.log(`[raw] ${text.slice(0, 200)}`);
});

ws.addEventListener("error", (e) => { console.error(`✗ WS error: ${e.message ?? e.type}`); process.exit(1); });
ws.addEventListener("close", () => { if (!done) { console.error("✗ WS 意外关闭"); process.exit(1); } });

function handleEvent(name, data) {
  switch (name) {
    case "started":
      console.log(`[started] conversation=${data.conversationId} model=${data.model.modelName}`);
      break;
    case "delta":
      process.stdout.write(data.delta);
      break;
    case "tool":
      console.log(`\n[tool] ${data.name} ok=${data.ok} durationMs=${data.durationMs}`);
      console.log(`       message.content=${data.message.content?.slice(0, 150)}`);
      console.log(`       message.toolCallId=${data.message.toolCallId ?? "(无)"}`);
      break;
    case "trace":
      if (["tool.started", "tool.done", "tool.failed", "phase.started", "phase.done", "agent.started", "agent.done", "agent.failed", "budget.hit"].includes(data.type)) {
        console.log(`[trace.${data.type}] ${data.summary}`);
      }
      break;
    case "done":
      done = true;
      console.log(`\n[done] content=${data.message.content?.slice(0, 200)}`);
      console.log(`[done] toolCalls=${JSON.stringify(data.message.toolCalls) ?? "(无)"}`);
      console.log(`[done] toolCallId=${data.message.toolCallId ?? "(无)"}`);
      console.log(`\n✓ 总事件数 ${eventCount}`);
      setTimeout(() => { ws.close(); process.exit(0); }, 300);
      break;
    case "error":
      console.error(`\n[error] ${data.error}`);
      done = true;
      setTimeout(() => { ws.close(); process.exit(1); }, 300);
      break;
    default:
      console.log(`\n[${name}] ${JSON.stringify(data)?.slice(0, 150)}`);
  }
}

setTimeout(() => {
  console.error(`\n⏰ 45 秒超时（事件数 ${eventCount}）`);
  process.exit(1);
}, 45000);
