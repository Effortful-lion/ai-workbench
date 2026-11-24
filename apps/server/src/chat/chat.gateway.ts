import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import { hasPermission, type Role } from "@aiwb/shared";
import type { ChatSendPayload, ChatErrorPayload } from "@aiwb/shared";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { ChatOrchestrator } from "./chat-orchestrator.service";
import { WorkspaceOwner } from "../common/workspace-owner";

/** 对话中枢 WS 通道：握手带 accessToken，事件流 send → started → (delta|tool|trace)×N → done。
 *  网关只负责连接生命周期与事件收发；编排逻辑下沉到 ChatOrchestrator。 */
@WebSocketGateway({ namespace: "/chat", cors: { origin: true, credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger("chat");
  /** 每个连接当前正在生成的请求；stop 事件/断线时中断 */
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly jwt: JwtService,
    private readonly owner: WorkspaceOwner,
    private readonly orchestrator: ChatOrchestrator,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Socket.IO/WebSocket 握手里拿 token：auth 优先（socket.io-client 在 polling 下会同时放 query）
      const token: string | undefined =
        (client.handshake.auth?.token as string) ??
        client.handshake.query?.token as string | undefined ??
        client.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) throw new Error("missing token");
      const payload = await this.jwt.verifyAsync<{ sub: string; username: string; role: Role }>(token);
      const user: AuthUser = { id: payload.sub, selfId: payload.sub, username: payload.username, role: payload.role };
      if (!hasPermission(user.role, "chat:use")) throw new Error("requires chat:use");
      client.data.user = user;
    } catch {
      client.emit("error", { error: "unauthorized" } satisfies ChatErrorPayload);
      client.disconnect(true);
    }
  }

  /** 断线即中止，避免后台仍消耗模型 token */
  handleDisconnect(client: Socket) {
    this.running.get(client.id)?.abort();
    this.running.delete(client.id);
  }

  /** 用户点「停止」：中断当前 SSE 流，已生成的部分文本由 onSend 收尾落库 */
  @SubscribeMessage("stop")
  onStop(@ConnectedSocket() client: Socket) {
    const ctrl = this.running.get(client.id);
    if (!ctrl) return;
    ctrl.abort();
    this.log.log(`stop requested by ${client.id}`);
  }

  @SubscribeMessage("send")
  async onSend(@ConnectedSocket() client: Socket, @MessageBody() body: ChatSendPayload) {
    const user = client.data.user as AuthUser | undefined;
    if (!user) return client.emit("error", { error: "unauthorized" } satisfies ChatErrorPayload);
    const content = (body?.content ?? "").trim();
    if (!content) return;
    // 展示型数据归站点主人：Agent 工具读 admin 的内容；会话/站内信仍按登录人自己
    const dataId = user.role === "owner" ? user.id : await this.owner.id();

    const abort = new AbortController();
    this.running.set(client.id, abort);
    try {
      // 编排逻辑下沉到 ChatOrchestrator，网关只负责连接生命周期与事件收发
      await this.orchestrator.run({
        user,
        dataId,
        content,
        conversationId: body.conversationId,
        agentId: body.agentId,
        modelId: body.modelId,
        clientId: client.id,
        abortController: abort,
        emit: (event, payload) => client.emit(event, payload),
      });
    } finally {
      // 只清理自己，避免误删同一连接上后续请求的 controller
      if (this.running.get(client.id) === abort) this.running.delete(client.id);
    }
  }
}
