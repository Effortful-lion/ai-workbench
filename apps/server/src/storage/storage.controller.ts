import { Body, Controller, Delete, Get, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { StorageService } from "./storage.service";

@Controller("storage")
export class StorageController {
  constructor(private readonly svc: StorageService) {}

  /** 桶概览：对象数 / 总字节（用于状态展示与能力摘要） */
  @Get("digest")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("storage:read")
  digest() {
    return this.svc.digest();
  }

  @Get("objects")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("storage:read")
  list(@Query("prefix") prefix?: string, @Query("maxKeys") maxKeys?: string) {
    return this.svc.list(prefix, maxKeys ? Number(maxKeys) : undefined);
  }

  /** 读小文本对象（≤256KB）；大对象请用 presign/get */
  @Get("object")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("storage:read")
  getText(@Query("key") key: string) {
    return this.svc.getText(key);
  }

  /** 写小文本对象（≤256KB）：报告、草稿、配置等 */
  @Post("object")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("storage:write")
  putText(@Body() body: { key: string; content: string; contentType?: string }) {
    return this.svc.putText(body?.key, body?.content, body?.contentType);
  }

  /** 预签名下载 URL：大文件不经过服务器与模型上下文 */
  @Post("presign/get")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("storage:read")
  presignGet(@Body() body: { key: string; expirySec?: number }) {
    return this.svc.presignGet(body?.key, body?.expirySec);
  }

  /** 预签名上传 URL：客户端直连 MinIO 放大文件 */
  @Post("presign/put")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("storage:write")
  presignPut(@Body() body: { key: string; expirySec?: number }) {
    return this.svc.presignPut(body?.key, body?.expirySec);
  }

  /** 删除：仅允许 ai-workbench/ 前缀（护栏） */
  @Delete("object")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("storage:write")
  remove(@Query("key") key: string) {
    return this.svc.remove(key);
  }
}
