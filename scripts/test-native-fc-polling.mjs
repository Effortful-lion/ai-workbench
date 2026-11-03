#!/usr/bin/env node
/**
 * Socket.IO polling transport 测试原生 function calling Gateway 完整链路。
 * 纯 HTTP GET/POST，不依赖 WebSocket。
 *
 *   node scripts/test-native-fc-polling.mjs mock    → mock:// + Gateway
 *   node scripts/test-native-fc-polling.mjs doubao  → 真实豆包 + Gateway
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const mode = process.argv[2] ?? "mock";
const prompt = process.argv[3] ?? (mode === "mock" ? "帮我看看 mail" : "帮我看看 mail");

const cfg = JSON.parse(readFileSync(join(process.env.HOME, ".aiwb/config.json"), "utf8"));
const baseUrl = cfg.server.replace(/\/+$/, "");
console.log(`▶ Socket.IO polling  ${baseUrl}/chat  mode=${mode}  prompt="${prompt}"`);

// 登录拿 token
const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: cfg.username ?? "admin", password: cfg.password ?? "admin" }),
});
const loginData = await loginRes.json();
const token = loginData.tokens?.accessToken ?? loginData.accessToken;
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
console.log(`▶ 模型 ${model.modelName} (${model.provider})\n`);

// Socket.IO polling: Engine.IO 握手拿 sid
// Nest Socket.IO 默认 Engine.IO 端点是 /socket.io，namespace /chat 在 Socket.IO 层路由
const EIO_PATH = "/socket.io";
const query = new URLSearchParams({ EIO: "4", transport: "polling", token });
const handshakeRes = await fetch(`${baseUrl}${EIO_PATH}/?${query}`, { headers: { authorization: `Bearer ${token}` } });
const handshakeText = await handshakeRes.text();
console.log(`▶ Engine.IO open: ${handshakeText.slice(0, 120)}`);
// Engine.IO open packet format: 0{"sid":"xxx","upgrades":["websocket"],"pingInterval":...,"pingTimeout":...}
const openMatch = handshakeText.match(/0(\{.*\})/);
if (!openMatch) { console.error(`✗ 解析 Engine.IO open 失败: ${handshakeText}`); process.exit(1); }
const { sid } = JSON.parse(openMatch[1]);
console.log(`▶ sid=${sid}`);

const qs = new URLSearchParams({ EIO: "4", transport: "polling", sid, token });
const url = `${baseUrl}${EIO_PATH}/?${qs}`;

// Socket.IO 握手：namespace 是 /chat，所以发 "40/chat"
let r = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "40/chat" });
console.log(`▶ Socket.IO handshake 发送 40/chat → ${(await r.text()).slice(0, 80)}`);

// 开一个后台 GET 循环收事件
const events = [];
const pendingPolls = [];
let stopPolling = false;
const pollLoop = async () => {
  while (!stopPolling) {
    try {
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      const text = await res.text();
      pendingPolls.push(text);
      // 解析每条 Engine.IO packet
      const packets = [];
      let idx = 0;
      while (idx < text.length) {
        const type = text[idx];
        idx++;
        let data = "";
        if (type === "4") {
          // Socket.IO message: 42=event, 43=ack, 44=connect_error, 41=disconnect
          // Engine.IO 在 Socket.IO packet 前可能有长度前缀
          // 但对于 4.x polling，格式直接是 type + payload
          // 等等，Engine.IO 4.x polling 的 message 有 4 和 6 两种 type
          // type 4 = text message，后面跟 Socket.IO payload
          const payloadType = text[idx];
          idx++;
          // Socket.IO 42 = event
          let end = idx;
          let depth = 0;
          let inStr = false;
          let esc = false;
          while (end < text.length) {
            const c = text[end];
            if (esc) { esc = false; end++; continue; }
            if (c === "\\") { esc = true; end++; continue; }
            if (c === '"') { inStr = !inStr; end++; continue; }
            if (!inStr) {
              if (c === "[" || c === "{") depth++;
              else if (c === "]" || c === "}") depth--;
              else if (depth === 0 && (c === "\n" || c === "\u001e")) break;
            }
            end++;
          }
          data = text.slice(idx, end);
          idx = end;
          packets.push({ type: "4", payloadType, payload: data });
        } else {
          // ping/pong/close
          break;
        }
      }
      for (const p of packets) {
        if (p.payloadType === "2") { // 42 = event
          try {
            const parsed = JSON.parse(p.payload);
            const [eventName, ...rest] = parsed;
            events.push({ name: eventName, data: rest[0] });
            handleEvent(eventName, rest[0]);
          } catch (e) {
            console.log(`[raw-event] ${p.payload.slice(0, 120)}`);
          }
        }
      }
      if (events.some((e) => e.name === "done" || e.name === "error")) break;
    } catch (e) {
      // poll 超时（30s）正常，继续
      if (e.name !== "AbortError") console.log(`[poll] ${e.message}`);
    }
  }
};

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
      console.log(`       message.content=${data.message.content?.slice(0, 120)}`);
      console.log(`       message.toolCallId=${data.message.toolCallId ?? "(无)"}`);
      break;
    case "trace":
      if (["tool.started", "tool.done", "tool.failed", "phase.started", "phase.done", "agent.started", "agent.done", "agent.failed", "budget.hit"].includes(data.type)) {
        console.log(`[trace.${data.type}] ${data.summary}`);
      }
      break;
    case "done":
      console.log(`\n[done] content=${data.message.content?.slice(0, 200)}`);
      console.log(`[done] toolCalls=${JSON.stringify(data.message.toolCalls) ?? "(无)"}`);
      console.log(`[done] toolCallId=${data.message.toolCallId ?? "(无)"}`);
      stopPolling = true;
      break;
    case "error":
      console.error(`\n[error] ${data.error}`);
      stopPolling = true;
      process.exit(1);
      break;
    default:
      console.log(`\n[${name}] ${JSON.stringify(data)?.slice(0, 120)}`);
  }
}

// 开一个 40s 超时的后台 GET
const pollPromise = pollLoop();

// 发 send 事件：42["send",{...}]
const sendPayload = `42${JSON.stringify(["send", { content: prompt, modelId }])}`;
console.log(`▶ 发送 42["send",{content:"${prompt}",modelId:"${modelId.slice(0, 8)}..."}]`);
r = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: sendPayload });
const sendAck = (await r.text()).trim();
console.log(`▶ ack: ${sendAck}\n`);

// 等待 60s 让 Gateway 完整跑完
const deadline = Date.now() + 60000;
while (!stopPolling && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
}
if (!stopPolling) {
  console.error("⏰ 60s 超时");
  process.exit(1);
}

// 看 DB meta
{
  const db = new (require(join(root, "apps/server/node_modules/better-sqlite3")))(join(root, "data/workbench.db"), { readonly: true });
  const rows = db.prepare("SELECT role, substr(content,1,40) as content, meta FROM messages ORDER BY rowid DESC LIMIT 8").all();
  console.log("\n── DB 最近 8 条消息 ──");
  for (const row of rows) {
    console.log(`  role=${row.role} content="${row.content}..." meta=${row.meta ?? "(null)"}`);
  }
  db.close();
}
console.log("\n✓ 完成");
