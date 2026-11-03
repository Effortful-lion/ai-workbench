import { io, type Socket } from "socket.io-client";

/** 对话中枢通道（走 vite proxy /socket.io，握手带 accessToken） */
export function createChatSocket(token: string): Socket {
  return io("/chat", { auth: { token } });
}
