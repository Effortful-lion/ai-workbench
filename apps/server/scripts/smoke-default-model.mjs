/* 聊天链路冒烟：不传 modelId，验证服务端 pickModel 命中 is_default 模型。
 * 用法：node scripts/smoke-default-model.mjs
 * 依赖：apps/server/node_modules 里的 socket.io-client（cwd 需在 apps/server）。 */
import { io } from "socket.io-client";

const API = "http://localhost:8700/api";

const creds = { username: `smoke_${Date.now()}`, password: "smoke123456" };
const login = await fetch(`${API}/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(creds),
}).then((r) => r.json());
const token = login.tokens?.accessToken ?? login.accessToken;
if (!token) {
  console.error("LOGIN_FAIL", login);
  process.exit(1);
}
console.log("login ok");

const socket = io("http://localhost:8700/chat", {
  auth: { token },
  transports: ["websocket"],
});

const kill = (code, msg) => {
  console.log(msg);
  socket.disconnect();
  process.exit(code);
};
setTimeout(() => kill(2, "TIMEOUT 120s"), 120_000);

let sawDelta = false;
socket.on("connect", () => {
  console.log("socket connected");
  // 故意不传 modelId —— 应由服务端默认模型接管
  socket.emit("send", { content: "用一句话介绍你自己" });
});
socket.on("started", (p) => {
  console.log("STARTED model =", `${p.model.provider}/${p.model.modelName}`, `(id=${p.model.id})`);
});
socket.on("delta", () => {
  if (!sawDelta) {
    sawDelta = true;
    console.log("delta streaming...");
  }
});
socket.on("tool", (p) => console.log("TOOL", p.name, p.ok ? "ok" : `fail:${p.error}`));
socket.on("done", (p) => {
  console.log("DONE content:", p.message.content.slice(0, 120));
  kill(0, "SMOKE_PASS");
});
socket.on("error", (p) => kill(3, `ERROR event: ${JSON.stringify(p)}`));
socket.on("connect_error", (e) => kill(4, `CONNECT_ERROR: ${e.message}`));
