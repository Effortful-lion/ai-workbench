# KB 扁平存储 + 软链接树形视图 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 知识库实现「底层扁平存储 + 上层软链接树形视图」分离架构：目录仅是视图容器，文档与向量始终扁平一份，通过多对多映射挂载到多个目录，支持全局/目录范围双模式检索、移除链接与删除本体语义严格区分。

**Architecture:** SQLite 新增 `kb_folders`（目录节点，邻接表）与 `kb_links`（文档↔目录多对多软链接，唯一约束）；`kb_documents` 增加 `primaryFolderId` 主归属；Qdrant payload 增加 `primary_path` 路径语义增强、search 支持 doc_id 集合过滤；LightRAG 链路全局召回后应用层过滤。前端 KbPanel docs Tab 重构为终端风文件树 + 拖拽挂载。

**Tech Stack:** NestJS + Drizzle(better-sqlite3) + Qdrant REST + React 19 + TailwindCSS 4 + HTML5 Drag & Drop。

**设计文档:** `docs/superpowers/specs/2026-11-08-kb-softlink-tree-design.md`

**约定:** 本项目无单测框架，验证方式为「构建通过 + API/页面手测」（遵循项目现状）；每任务结束构建一次。提交信息格式遵循现有 git log 风格（feat/fix 前缀，中文描述）。

---

## 文件结构总览

| 动作 | 文件 | 职责 |
|---|---|---|
| Modify | `packages/shared/src/kb.ts` | 目录/链接/范围检索类型 |
| Modify | `packages/shared/src/operations.ts` | KB 操作目录补 folder/link API 与 folderId 参数 |
| Modify | `apps/server/src/db/schema.ts` | kb_folders / kb_links 表 + primaryFolderId 列 |
| Modify | `apps/server/src/kb/qdrant.service.ts` | payload primary_path + docIds 过滤 |
| Modify | `apps/server/src/kb/kb.service.ts` | 目录 CRUD / 挂载移除 / 子树解析 / 范围检索 / 删除清理 |
| Modify | `apps/server/src/kb/kb.controller.ts` | 新路由 |
| Create | `apps/server/src/tools/kb.tools.ts` | `kb.search` Agent 工具 |
| Modify | `apps/server/src/tools/tools.module.ts` | 注册 KbTools |
| Create | `apps/web/src/features/kb/KbTreeView.tsx` | 终端风文件树 + 拖拽挂载/移除链接 |
| Modify | `apps/web/src/features/kb/KbPanel.tsx` | 树形视图集成、范围切换、上传主归属目录 |
| Create | `docs/devlog/062-kb-softlink-tree.md` | 开发日志 |

---

### Task 1: shared 类型 + 操作目录

**Files:**
- Modify: `packages/shared/src/kb.ts`
- Modify: `packages/shared/src/operations.ts:527-622`（KB_OPERATIONS）

- [ ] **Step 1.1: kb.ts 增加目录/链接类型**

在 `packages/shared/src/kb.ts` 的 `KbDocumentDto` 之前插入目录树类型，并给现有 DTO 扩展字段：

```typescript
/** kb 目录节点：纯视图容器，不持有文档本体，不参与检索 */
export interface KbFolderDto {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  /** 该目录下直接挂载的文档数 */
  docCount: number;
  createdAt: number;
}

export interface KbFolderNodeDto extends KbFolderDto {
  children: KbFolderNodeDto[];
}

/** 软链接：文档 ↔ 目录挂载关系，仅引用，不复制本体/切片/向量 */
export interface KbLinkDto {
  id: string;
  documentId: string;
  folderId: string;
  createdAt: number;
}

/** 目录树 + 全部挂载关系，前端本地拼装视图 */
export interface KbFolderTreeDto {
  folders: KbFolderNodeDto[];
  links: KbLinkDto[];
}

export interface KbCreateFolderInput {
  name: string;
  parentId?: string;
}

export interface KbUpdateFolderInput {
  name?: string;
  parentId?: string | null;
}

export interface KbLinkInput {
  documentId: string;
  folderId: string;
}

export interface KbSearchInput {
  query: string;
  topK?: number;
  /** 传入=目录范围检索（含子目录）；不传=全局扁平召回 */
  folderId?: string;
}
```

- [ ] **Step 1.2: 扩展现有 DTO**

`KbDocumentDto` 增加 `primaryFolderId`；`KbIngestInput` 增加 `folderId`；`KbSearchHitDto` 增加 `primaryPath`；`KbSearchResultDto` 增加 `scopeFiltered`：

```typescript
export interface KbDocumentDto {
  id: string;
  title: string;
  /** 终端文件树风格的虚拟路径，如 ~/kb/部署手册.md */
  path: string;
  mime: string;
  size: number;
  status: "embedded" | "pending" | "error";
  chunkCount: number;
  error?: string | null;
  /** 主归属目录 id（原始上传路径），null=未归类 */
  primaryFolderId?: string | null;
  createdAt: number;
}

export interface KbIngestInput {
  title: string;
  /** 纯文本内容（一期仅支持文本类文档） */
  content: string;
  mime?: string;
  /** 主归属目录 id：写入 chunk primary_path 做路径语义增强；缺省=未归类 */
  folderId?: string;
}

export interface KbSearchHitDto {
  docId: string;
  docTitle: string;
  chunkIx: number;
  /** 余弦相似度 0..1 */
  score: number;
  text: string;
  /** 主归属虚拟路径（路径语义增强，可空=存量文档未回填） */
  primaryPath?: string;
}

export interface KbSearchResultDto {
  query: string;
  hits: KbSearchHitDto[];
  /** embedding 来源：model=真实模型接口 / local=本地确定性向量 */
  embedding: "model" | "local";
  latencyMs: number;
  /** true=目录范围检索经 LightRAG 全局召回后应用层过滤（结果可能少于 topK） */
  scopeFiltered?: boolean;
}
```

- [ ] **Step 1.3: operations.ts 的 KB_OPERATIONS 更新**

`packages/shared/src/operations.ts` 中 `kb.search.post` 的 params 增加 folderId，并在 `kb.ask` 条目之后（`]` 结束前）追加目录与链接操作：

```typescript
  {
    key: "kb.search.post",
    module: "kb",
    action: "search.post",
    summary: "检索知识库片段（POST 版，可指定 topK 与目录范围）",
    method: "POST",
    path: "/kb/search",
    permission: "kb:read",
    risk: "write",
    params: [
      { name: "query", in: "body", type: "string", required: true, desc: "检索关键词" },
      { name: "topK", in: "body", type: "number", desc: "返回片段数" },
      {
        name: "folderId",
        in: "body",
        type: "string",
        desc: "目录 id：传入则只在该目录（含子目录）挂载的文档内检索",
      },
    ],
  },
```

追加的操作定义：

```typescript
  {
    key: "kb.folders.list",
    module: "kb",
    action: "folders.list",
    summary: "获取知识库目录树与全部挂载关系（软链接视图）",
    method: "GET",
    path: "/kb/folders",
    permission: "kb:read",
    risk: "read",
  },
  {
    key: "kb.folders.create",
    module: "kb",
    action: "folders.create",
    summary: "新建知识库目录（视图容器，不影响检索）",
    method: "POST",
    path: "/kb/folders",
    permission: "kb:write",
    risk: "write",
    params: [
      { name: "name", in: "body", type: "string", required: true, desc: "目录名" },
      { name: "parentId", in: "body", type: "string", desc: "父目录 id，缺省=根" },
    ],
  },
  {
    key: "kb.folders.update",
    module: "kb",
    action: "folders.update",
    summary: "重命名 / 移动知识库目录",
    method: "PATCH",
    path: "/kb/folders/:id",
    permission: "kb:write",
    risk: "write",
    params: [
      { name: "id", in: "path", type: "string", required: true, desc: "目录 id" },
      { name: "name", in: "body", type: "string", desc: "新目录名" },
      { name: "parentId", in: "body", type: "string", desc: "新父目录 id，null=移到根" },
    ],
  },
  {
    key: "kb.folders.delete",
    module: "kb",
    action: "folders.delete",
    summary: "删除目录（子目录级联；仅删视图与映射，文档本体/向量保留）",
    method: "DELETE",
    path: "/kb/folders/:id",
    permission: "kb:write",
    risk: "destructive",
    params: [{ name: "id", in: "path", type: "string", required: true, desc: "目录 id" }],
  },
  {
    key: "kb.links.mount",
    module: "kb",
    action: "links.mount",
    summary: "把文档挂载到目录（软链接，可多对多，不复制本体）",
    method: "POST",
    path: "/kb/links",
    permission: "kb:write",
    risk: "write",
    params: [
      { name: "documentId", in: "body", type: "string", required: true, desc: "文档 id" },
      { name: "folderId", in: "body", type: "string", required: true, desc: "目录 id" },
    ],
  },
  {
    key: "kb.links.remove",
    module: "kb",
    action: "links.remove",
    summary: "移除挂载链接（仅删映射，文档本体/向量/其他目录视图保留）",
    method: "DELETE",
    path: "/kb/links/:id",
    permission: "kb:write",
    risk: "write",
    params: [{ name: "id", in: "path", type: "string", required: true, desc: "链接 id" }],
  },
```

- [ ] **Step 1.4: 构建 shared 验证**

Run: `pnpm --filter @aiwb/shared build`
Expected: 编译通过，无类型错误。

- [ ] **Step 1.5: Commit**

```bash
git add packages/shared/src/kb.ts packages/shared/src/operations.ts
git commit -m "feat(kb): 目录树/软链接/范围检索共享类型与操作目录"
```

---

### Task 2: Drizzle schema + 建表

**Files:**
- Modify: `apps/server/src/db/schema.ts:1-3`（imports）、`:93-111`（kbDocuments）、其后新增两表

- [ ] **Step 2.1: imports 增加 unique**

`apps/server/src/db/schema.ts` 第 1 行 drizzle-orm import 中加入 `unique`：

```typescript
import { integer, sqliteTable, text, unique } from "drizzle-orm";
```

（以文件现有 import 为准，只补 `unique`，不改动其他导入。）

- [ ] **Step 2.2: kbDocuments 增加主归属列**

在 `kbDocuments` 表定义的 `error: text("error"),` 之后、`createdAt` 之前插入：

```typescript
  /** 主归属目录 id（原始上传路径），可空=未归类；额外挂载不覆盖它 */
  primaryFolderId: text("primary_folder_id"),
```

- [ ] **Step 2.3: 新增 kbFolders / kbLinks 表**

在 `kbDocuments` 表定义结束后、`toolboxItems` 之前插入：

```typescript
/** kb 目录树：纯视图容器（面向人），不持有文档本体、不向量化、不参与检索 */
export const kbFolders = sqliteTable("kb_folders", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** 父目录 id，null=根；不使用外键，环检测在 service 层做（移动时拒绝进自身子树） */
  parentId: text("parent_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** kb 软链接：文档 ↔ 目录多对多挂载，仅引用关系——不复制文档、不重复切片、不重复入向量 */
export const kbLinks = sqliteTable(
  "kb_links",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => kbDocuments.id, { onDelete: "cascade" }),
    folderId: text("folder_id")
      .notNull()
      .references(() => kbFolders.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [unique("kb_links_doc_folder_uq").on(t.documentId, t.folderId)],
);
```

- [ ] **Step 2.4: 推送 schema 到 SQLite**

Run: `make db-push`
Expected: `schema 已同步`，drizzle-kit push 为 kb_documents 加列、创建 kb_folders / kb_links 表。

- [ ] **Step 2.5: 验证表结构**

Run: `sqlite3 data/workbench.db ".schema kb_links" ".schema kb_folders"`
Expected: 两个建表语句存在，kb_links 含 `UNIQUE(document_id, folder_id)`；`sqlite3 data/workbench.db "PRAGMA table_info(kb_documents);" | grep primary_folder_id` 有输出。

- [ ] **Step 2.6: Commit**

```bash
git add apps/server/src/db/schema.ts
git commit -m "feat(kb): kb_folders/kb_links 软链接树 schema + 主归属列"
```

---

### Task 3: Qdrant payload 路径增强 + docIds 过滤

**Files:**
- Modify: `apps/server/src/kb/qdrant.service.ts:7-13`（ChunkPayload）、`:96-120`（search）

- [ ] **Step 3.1: ChunkPayload 增加 primary_path**

```typescript
export interface ChunkPayload {
  doc_id: string;
  chunk_ix: number;
  user_id: string;
  doc_title: string;
  text: string;
  /** 主归属虚拟路径（路径语义增强，可空=存量文档未回填） */
  primary_path?: string;
}
```

- [ ] **Step 3.2: search 支持目录范围 docIds 过滤**

`search` 方法整体替换为：

```typescript
  /** 扁平向量召回：user_id 隔离必选；docIds 传入时作为目录范围过滤（match any）。
   *  docIds 为空数组表示该范围内无文档，直接返回空结果。 */
  async search(
    vector: number[],
    userId: string,
    topK: number,
    docIds?: string[],
  ): Promise<SearchHit[]> {
    if (!this.ready) return [];
    if (docIds && docIds.length === 0) return [];
    const name = this.collection(vector.length);
    const exists = await this.req(`/collections/${name}`, {}, 3000);
    if (!exists.ok) return [];
    const must: unknown[] = [{ key: "user_id", match: { value: userId } }];
    if (docIds?.length) must.push({ key: "doc_id", match: { any: docIds } });
    const res = await this.req(
      `/collections/${name}/points/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vector,
          limit: topK,
          with_payload: true,
          filter: { must },
        }),
      },
      10_000,
    );
    if (!res.ok) throw new Error(`search failed: ${await res.text()}`);
    const data = (await res.json()) as {
      result?: { score: number; payload: ChunkPayload }[];
    };
    return (data.result ?? []).map((r) => ({ score: r.score, payload: r.payload }));
  }
```

- [ ] **Step 3.3: 构建验证**

Run: `pnpm --filter @aiwb/server build`
Expected: 编译通过（kb.service 尚未传 docIds，签名向后兼容）。

- [ ] **Step 3.4: Commit**

```bash
git add apps/server/src/kb/qdrant.service.ts
git commit -m "feat(kb): qdrant payload primary_path + doc_id 集合范围过滤"
```

---

### Task 4: KbService 目录树 / 软链接 / 范围检索 / 删除语义

**Files:**
- Modify: `apps/server/src/kb/kb.service.ts`（imports、ingest、processDocument、search、removeDocument、新增方法）

- [ ] **Step 4.1: 更新 imports**

第 2 行 drizzle import 加入 `inArray`、`asc`：

```typescript
import { and, asc, desc, eq, inArray } from "drizzle-orm";
```

第 6-13 行共享类型 import 补充：

```typescript
import type {
  KbAskMode,
  KbAskResultDto,
  KbCreateFolderInput,
  KbDocumentDto,
  KbFolderDto,
  KbFolderNodeDto,
  KbFolderTreeDto,
  KbIngestInput,
  KbLinkDto,
  KbLinkInput,
  KbSearchHitDto,
  KbSearchResultDto,
  KbUpdateFolderInput,
} from "@aiwb/shared";
```

第 15 行 schema import 加入新表：

```typescript
import { kbDocuments, kbFolders, kbLinks } from "../db/schema";
```

- [ ] **Step 4.2: toDto 带出主归属**

`toDto` 返回对象中 `error: d.error,` 之后加：

```typescript
      primaryFolderId: d.primaryFolderId,
```

- [ ] **Step 4.3: 新增目录树与软链接方法**

在 `listDocuments` 方法之后插入（完整代码）：

```typescript
  // ==================== 目录树（视图层） ====================

  /** 目录树 + 全部挂载关系。目录仅是视图容器：不持有文档本体、不向量化、不参与检索。 */
  async listFolders(userId: string): Promise<KbFolderTreeDto> {
    const [folderRows, linkRows] = await Promise.all([
      this.db
        .select()
        .from(kbFolders)
        .where(eq(kbFolders.ownerId, userId))
        .orderBy(asc(kbFolders.sortOrder), asc(kbFolders.createdAt)),
      this.db.select().from(kbLinks).where(eq(kbLinks.ownerId, userId)),
    ]);
    const nodes = new Map<string, KbFolderNodeDto>();
    for (const f of folderRows) {
      nodes.set(f.id, {
        id: f.id,
        parentId: f.parentId,
        name: f.name,
        sortOrder: f.sortOrder,
        docCount: 0,
        createdAt: f.createdAt.getTime(),
        children: [],
      });
    }
    for (const l of linkRows) {
      const n = nodes.get(l.folderId);
      if (n) n.docCount += 1;
    }
    const roots: KbFolderNodeDto[] = [];
    for (const f of folderRows) {
      const n = nodes.get(f.id);
      if (!n) continue;
      const parent = f.parentId ? nodes.get(f.parentId) : undefined;
      if (parent) parent.children.push(n);
      else roots.push(n);
    }
    return {
      folders: roots,
      links: linkRows.map((l) => ({
        id: l.id,
        documentId: l.documentId,
        folderId: l.folderId,
        createdAt: l.createdAt.getTime(),
      })),
    };
  }

  async createFolder(userId: string, input: KbCreateFolderInput): Promise<KbFolderDto> {
    const name = input.name.trim();
    if (!name) throw new Error("目录名不能为空");
    let parentId: string | null = null;
    if (input.parentId) {
      const [parent] = await this.db
        .select({ id: kbFolders.id })
        .from(kbFolders)
        .where(and(eq(kbFolders.id, input.parentId), eq(kbFolders.ownerId, userId)));
      if (!parent) throw new NotFoundException("parent folder not found");
      parentId = parent.id;
    }
    const [row] = await this.db
      .insert(kbFolders)
      .values({ id: randomUUID(), ownerId: userId, name, parentId, createdAt: new Date() })
      .returning();
    return {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      sortOrder: row.sortOrder,
      docCount: 0,
      createdAt: row.createdAt.getTime(),
    };
  }

  /** 重命名 / 移动。移动做防环校验：目标不能是自身或自身子树中的目录。 */
  async updateFolder(userId: string, id: string, input: KbUpdateFolderInput): Promise<KbFolderDto> {
    const [row] = await this.db
      .select()
      .from(kbFolders)
      .where(and(eq(kbFolders.id, id), eq(kbFolders.ownerId, userId)));
    if (!row) throw new NotFoundException("folder not found");

    const patch: Partial<typeof kbFolders.$inferInsert> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("目录名不能为空");
      patch.name = name;
    }
    if (input.parentId !== undefined) {
      if (input.parentId === null) {
        patch.parentId = null;
      } else {
        if (input.parentId === id) throw new Error("不能把目录移动到自身下");
        const subtree = await this.folderSubtreeIds(userId, id);
        if (subtree.has(input.parentId)) throw new Error("不能把目录移动到自己的子目录下");
        const [parent] = await this.db
          .select({ id: kbFolders.id })
          .from(kbFolders)
          .where(and(eq(kbFolders.id, input.parentId), eq(kbFolders.ownerId, userId)));
        if (!parent) throw new NotFoundException("parent folder not found");
        patch.parentId = input.parentId;
      }
    }
    if (Object.keys(patch).length) {
      await this.db.update(kbFolders).set(patch).where(eq(kbFolders.id, id));
    }
    const [fresh] = await this.db.select().from(kbFolders).where(eq(kbFolders.id, id));
    const links = await this.db
      .select({ documentId: kbLinks.documentId })
      .from(kbLinks)
      .where(and(eq(kbLinks.ownerId, userId), eq(kbLinks.folderId, id)));
    return {
      id: fresh.id,
      parentId: fresh.parentId,
      name: fresh.name,
      sortOrder: fresh.sortOrder,
      docCount: links.length,
      createdAt: fresh.createdAt.getTime(),
    };
  }

  /** 删除目录视图：删目录节点（子目录级联）+ 其下全部映射；文档本体与向量一律保留。 */
  async deleteFolder(userId: string, id: string): Promise<{ removedFolders: number; removedLinks: number }> {
    const ids = [...(await this.folderSubtreeIds(userId, id))];
    const linkRows = await this.db
      .select({ id: kbLinks.id })
      .from(kbLinks)
      .where(and(eq(kbLinks.ownerId, userId), inArray(kbLinks.folderId, ids)));
    await this.db
      .delete(kbLinks)
      .where(and(eq(kbLinks.ownerId, userId), inArray(kbLinks.folderId, ids)));
    // 主归属目录被删的文档退化为「未归类」，主归属虚拟路径展示字段保留原值
    await this.db
      .update(kbDocuments)
      .set({ primaryFolderId: null })
      .where(and(eq(kbDocuments.ownerId, userId), inArray(kbDocuments.primaryFolderId, ids)));
    await this.db
      .delete(kbFolders)
      .where(and(eq(kbFolders.ownerId, userId), inArray(kbFolders.id, ids)));
    return { removedFolders: ids.length, removedLinks: linkRows.length };
  }

  /** 目录 + 全部子目录 id 集合（含自身）。parentId 无外键，靠内存遍历。 */
  private async folderSubtreeIds(userId: string, folderId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ id: kbFolders.id, parentId: kbFolders.parentId })
      .from(kbFolders)
      .where(eq(kbFolders.ownerId, userId));
    const childrenOf = new Map<string, string[]>();
    for (const r of rows) {
      if (r.parentId) {
        const arr = childrenOf.get(r.parentId) ?? [];
        arr.push(r.id);
        childrenOf.set(r.parentId, arr);
      }
    }
    const ids = new Set<string>([folderId]);
    const queue = [folderId];
    while (queue.length) {
      const cur = queue.shift() as string;
      for (const c of childrenOf.get(cur) ?? []) {
        if (!ids.has(c)) {
          ids.add(c);
          queue.push(c);
        }
      }
    }
    return ids;
  }

  /** 目录链（根→自身）的名字序列；目录不存在时返回 null。移动操作的防环校验保证无死循环。 */
  private async folderChain(userId: string, folderId: string): Promise<string[] | null> {
    const rows = await this.db
      .select({ id: kbFolders.id, name: kbFolders.name, parentId: kbFolders.parentId })
      .from(kbFolders)
      .where(eq(kbFolders.ownerId, userId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const chain: string[] = [];
    const visited = new Set<string>();
    let cur = byId.get(folderId);
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      chain.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return chain.length ? chain : null;
  }

  // ==================== 软链接（挂载 / 移除） ====================

  /** 挂载：一份文档可挂多个目录，唯一约束防重复；不复制本体、不重复切片。 */
  async mountDocument(userId: string, input: KbLinkInput): Promise<KbLinkDto> {
    const [doc] = await this.db
      .select({ id: kbDocuments.id })
      .from(kbDocuments)
      .where(and(eq(kbDocuments.id, input.documentId), eq(kbDocuments.ownerId, userId)));
    if (!doc) throw new NotFoundException("document not found");
    const [folder] = await this.db
      .select({ id: kbFolders.id })
      .from(kbFolders)
      .where(and(eq(kbFolders.id, input.folderId), eq(kbFolders.ownerId, userId)));
    if (!folder) throw new NotFoundException("folder not found");
    await this.db
      .insert(kbLinks)
      .values({
        id: randomUUID(),
        ownerId: userId,
        documentId: input.documentId,
        folderId: input.folderId,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    const [row] = await this.db
      .select()
      .from(kbLinks)
      .where(and(eq(kbLinks.documentId, input.documentId), eq(kbLinks.folderId, input.folderId)));
    return {
      id: row.id,
      documentId: row.documentId,
      folderId: row.folderId,
      createdAt: row.createdAt.getTime(),
    };
  }

  /** 移除链接：仅删映射行。文档本体、向量切片、其他目录视图全部保留，全局检索仍可命中。 */
  async unlink(userId: string, linkId: string): Promise<void> {
    const res = await this.db
      .delete(kbLinks)
      .where(and(eq(kbLinks.id, linkId), eq(kbLinks.ownerId, userId)))
      .returning({ id: kbLinks.id });
    if (!res.length) throw new NotFoundException("link not found");
  }

  /** 目录范围 → doc_id 集合：子树内全部挂载的文档（只看映射表，与主归属无关）。 */
  private async scopeDocIds(userId: string, folderId: string): Promise<string[]> {
    const subtree = await this.folderSubtreeIds(userId, folderId);
    const rows = await this.db
      .select({ documentId: kbLinks.documentId })
      .from(kbLinks)
      .where(and(eq(kbLinks.ownerId, userId), inArray(kbLinks.folderId, [...subtree])));
    return [...new Set(rows.map((r) => r.documentId))];
  }
```

- [ ] **Step 4.4: ingest 支持主归属目录**

`ingest` 方法：签名不变；在 `const id = randomUUID();` 之前插入主归属解析，`row` 对象与 `path` 改为：

```typescript
    // 主归属目录（可选）：写入 chunk primary_path 做路径语义增强；额外挂载不覆盖它
    let primaryFolderId: string | null = null;
    let primaryPath = `~/kb/${title}`;
    if (input.folderId) {
      const chain = await this.folderChain(userId, input.folderId);
      if (!chain) throw new Error("主归属目录不存在");
      primaryFolderId = input.folderId;
      primaryPath = `~/kb/${[...chain, title].join("/")}`;
    }

    const id = randomUUID();
    const row: typeof kbDocuments.$inferSelect = {
      id,
      ownerId: userId,
      title,
      path: primaryPath,
      primaryFolderId,
      mime: input.mime ?? "text/plain",
      size: Buffer.byteLength(content, "utf8"),
      status: "pending",
      chunkCount: 0,
      error: null,
      createdAt: new Date(),
    };
```

`processDocument` 调用处（ingest 与 retryIngest 两处）追加主归属路径参数：

```typescript
    void this.processDocument(id, userId, title, content, primaryPath).catch((e) => {
```

retryIngest 中改为：

```typescript
    void this.processDocument(id, userId, doc.title, content, doc.path).catch((e) => {
```

- [ ] **Step 4.5: processDocument 写入 primary_path**

签名与 qdrant 分支 payload 改为（LightRAG 分支不变）：

```typescript
  private async processDocument(
    id: string,
    userId: string,
    title: string,
    content: string,
    primaryPath = `~/kb/${title}`,
  ): Promise<void> {
```

qdrant 分支 upsert payload：

```typescript
            payload: {
              doc_id: id,
              chunk_ix: ix,
              user_id: userId,
              doc_title: title,
              text,
              primary_path: primaryPath,
            },
```

- [ ] **Step 4.6: search 支持目录范围**

`search` 方法整体替换为：

```typescript
  /** 双模式检索：
   *  ① 全局（folderId 缺省）：全部扁平文档直接召回，与纯扁平方案行为一致；
   *  ② 目录范围（folderId 传入）：映射表取子树 doc_id 集合 → 向量库 metadata 过滤召回。
   *  LightRAG 链路不支持 metadata 过滤，只能全局召回后应用层过滤（scopeFiltered 标记）。 */
  async search(userId: string, query: string, topK = 5, folderId?: string): Promise<KbSearchResultDto> {
    const started = Date.now();
    const q = query.trim();
    if (!q) return { query, hits: [], embedding: "local", latencyMs: 0 };

    const docIds = folderId ? await this.scopeDocIds(userId, folderId) : undefined;

    if (this.useLightRag()) {
      const limit = Math.min(Math.max(topK, 1), 20);
      const chunks = await this.lightrag.queryData(q, limit);
      let hits = await this.chunksToHits(userId, chunks, limit);
      const scopeFiltered = !!docIds;
      if (docIds) {
        const allow = new Set(docIds);
        hits = hits.filter((h) => allow.has(h.docId));
      }
      return {
        query,
        hits,
        embedding: "model",
        latencyMs: Date.now() - started,
        scopeFiltered,
      };
    }

    const { vectors, source } = await this.embed.embed([q]);
    const hits = await this.qdrant.search(
      vectors[0],
      userId,
      Math.min(Math.max(topK, 1), 20),
      docIds,
    );
    return {
      query,
      embedding: source,
      latencyMs: Date.now() - started,
      hits: hits.map((h) => ({
        docId: h.payload.doc_id,
        docTitle: h.payload.doc_title,
        chunkIx: h.payload.chunk_ix,
        score: Math.round(h.score * 1000) / 1000,
        text: h.payload.text,
        primaryPath: h.payload.primary_path,
      })),
    };
  }
```

- [ ] **Step 4.7: removeDocument 清理全部映射**

在 `removeDocument` 的 `await this.db.delete(kbDocuments)...` 之前插入（同时把「删除文档本体」的注释补在方法头）：

```typescript
    // 删除文档本体：清除所有目录视图中的映射记录（文档在所有目录中消失）
    await this.db
      .delete(kbLinks)
      .where(and(eq(kbLinks.ownerId, userId), eq(kbLinks.documentId, id)));
```

- [ ] **Step 4.8: 构建验证**

Run: `pnpm --filter @aiwb/server build`
Expected: 编译通过。

- [ ] **Step 4.9: Commit**

```bash
git add apps/server/src/kb/kb.service.ts
git commit -m "feat(kb): 目录树/软链接 service + 双模式检索 + 删除语义分离"
```

---

### Task 5: Controller 路由

**Files:**
- Modify: `apps/server/src/kb/kb.controller.ts`

- [ ] **Step 5.1: imports 更新**

```typescript
import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from "@nestjs/common";
import type {
  KbAskInput, KbCreateFolderInput, KbIngestInput, KbLinkInput, KbSearchInput, KbUpdateFolderInput,
} from "@aiwb/shared";
```

- [ ] **Step 5.2: 新增目录/链接路由 + search 透传 folderId**

在 `@Controller` 内（`@Post("search")` 之前）插入：

```typescript
  // ---- 目录树（视图层）----

  @Get("folders")
  @RequirePerm("kb:read")
  listFolders(@CurrentUser() user: AuthUser) {
    return this.svc.listFolders(user.id);
  }

  @Post("folders")
  @RequirePerm("kb:write")
  async createFolder(@CurrentUser() user: AuthUser, @Body() body: KbCreateFolderInput) {
    try {
      return await this.svc.createFolder(user.id, body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Patch("folders/:id")
  @RequirePerm("kb:write")
  async updateFolder(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: KbUpdateFolderInput,
  ) {
    try {
      return await this.svc.updateFolder(user.id, id, body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** 删除目录仅删视图与映射；文档本体、向量切片保留 */
  @Delete("folders/:id")
  @RequirePerm("kb:write")
  deleteFolder(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.deleteFolder(user.id, id);
  }

  // ---- 软链接（挂载 / 移除）----

  @Post("links")
  @RequirePerm("kb:write")
  async mount(@CurrentUser() user: AuthUser, @Body() body: KbLinkInput) {
    try {
      return await this.svc.mountDocument(user.id, body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** 移除链接：仅删映射行，文档本体/向量/其他目录视图保留 */
  @Delete("links/:id")
  @RequirePerm("kb:write")
  unlink(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.unlink(user.id, id).then(() => ({ ok: true }));
  }
```

`@Post("search")` 方法替换为（透传 folderId）：

```typescript
  @Post("search")
  @RequirePerm("kb:read")
  search(@CurrentUser() user: AuthUser, @Body() body: KbSearchInput) {
    if (!body?.query?.trim()) throw new BadRequestException("query 不能为空");
    return this.svc.search(user.id, body.query, body.topK, body.folderId);
  }
```

- [ ] **Step 5.3: 构建验证**

Run: `pnpm --filter @aiwb/server build`
Expected: 编译通过。

- [ ] **Step 5.4: Commit**

```bash
git add apps/server/src/kb/kb.controller.ts
git commit -m "feat(kb): 目录/软链接 HTTP API + 范围检索参数"
```

---

### Task 6: kb.search Agent 工具

**Files:**
- Create: `apps/server/src/tools/kb.tools.ts`
- Modify: `apps/server/src/tools/tools.module.ts`

- [ ] **Step 6.1: 创建 kb.tools.ts**

```typescript
import { Injectable } from "@nestjs/common";
import type { ToolContext } from "@aiwb/shared";
import { RegisterTool } from "./register-tool.decorator";
import { KbService } from "../kb/kb.service";

/** kb 模块专属工具：Agent 检索知识库（全局或目录范围）。
 *  search.multi 的 kb 源保持全局语义不变；本工具补充目录范围能力。 */
@Injectable()
export class KbTools {
  constructor(private readonly kb: KbService) {}

  @RegisterTool({
    name: "kb.search",
    description:
      "检索本地知识库片段（文档/笔记/手册）。查站内资料时优先用；" +
      "用户限定「某目录/某分类下」时传 folderId 只在挂载文档内检索。",
    permission: "kb:read",
    argsSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词" },
        topK: { type: "number", description: "返回片段数，默认 5，最多 20" },
        folderId: {
          type: "string",
          description: "目录 id：传入则只在该目录（含子目录）挂载的文档内检索",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  })
  async search(ctx: ToolContext, args: Record<string, unknown>) {
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("query 不能为空");
    const topK = Number(args.topK ?? 5) || 5;
    const folderId = args.folderId ? String(args.folderId) : undefined;
    const r = await this.kb.search(ctx.userId, query, topK, folderId);
    return {
      query: r.query,
      scope: folderId ? `folder:${folderId}` : "global",
      ...(r.scopeFiltered
        ? { note: "当前链路不支持原生范围过滤，结果为全局召回后按目录过滤，可能不全" }
        : {}),
      hits: r.hits.map((h) => ({
        title: h.docTitle,
        path: h.primaryPath,
        chunk: h.chunkIx,
        score: h.score,
        snippet: h.text.slice(0, 200),
      })),
    };
  }
}
```

- [ ] **Step 6.2: tools.module.ts 注册**

```typescript
import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { ToolRegistry } from "./tool-registry.service";
import { OperationToolsService } from "./operation-tools.service";
import { CustomToolsService } from "./custom-tools.service";
import { WebTools } from "./web.tools";
import { SiteTools } from "./site.tools";
import { SearchTools } from "./search.tools";
import { KbTools } from "./kb.tools";
import { ToolsController } from "./tools.controller";
import { GithubModule } from "../github/github.module";
import { KbModule } from "../kb/kb.module";

/** Tool Registry 全局可见：任何模块的 provider 都可以用 @RegisterTool 注册能力 */
@Global()
@Module({
  imports: [DiscoveryModule, GithubModule, KbModule],
  providers: [ToolRegistry, OperationToolsService, CustomToolsService, WebTools, SiteTools, SearchTools, KbTools],
  controllers: [ToolsController],
  exports: [ToolRegistry],
})
export class ToolsModule {}
```

- [ ] **Step 6.3: 构建 + 启动验证工具注册**

Run: `pnpm --filter @aiwb/server build && make restart && sleep 3 && curl -s http://localhost:8700/api/tools | python3 -m json.tool | grep -A2 '"kb.search"'`
Expected: 输出含 `kb.search` 及其 description（若 tools 接口要求鉴权，改用 `pnpm cli tools.list` 或登录后带 token 请求）。

- [ ] **Step 6.4: Commit**

```bash
git add apps/server/src/tools/kb.tools.ts apps/server/src/tools/tools.module.ts
git commit -m "feat(kb): 注册 kb.search Agent 工具（支持目录范围）"
```

---

### Task 7: 前端 KbTreeView（终端风文件树 + 拖拽）

**Files:**
- Create: `apps/web/src/features/kb/KbTreeView.tsx`
- Modify: `apps/web/src/features/kb/KbPanel.tsx`

- [ ] **Step 7.1: 创建 KbTreeView.tsx**

```tsx
import { useRef, useState } from "react";
import type { KbFolderNodeDto, KbFolderTreeDto } from "@aiwb/shared";

/** 拖拽数据类型（自定义 MIME，避免与文件上传拖拽冲突） */
export const KB_DOC_DRAG = "text/x-kb-doc-id";

interface Ghost {
  x: number;
  y: number;
  label: string;
}

interface Props {
  tree: KbFolderTreeDto;
  scopeFolderId: string | null;
  canWrite: boolean;
  onScopeChange: (folderId: string | null) => void;
  onMountDoc: (docId: string, folderId: string) => void;
  /** 拖到「⌫ 移除链接」落区触发：仅解除该文档与当前目录的挂载 */
  onUnlinkDoc: (docId: string) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folderId: string) => void;
  onDeleteFolder: (folderId: string) => void;
}

/** 终端风目录树：`▸/▾` 折叠、等宽体路径；拖文档到目录挂载，拖到底部落区移除链接。
 *  视觉规范：悬停终端绿描边 + 辉光（box-shadow 0 0 12px #00E59B22），落点 ▌ 样式。 */
export default function KbTreeView(props: Props) {
  const { tree, scopeFolderId, canWrite } = props;
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [overDropZone, setOverDropZone] = useState(false);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const ghostLabel = useRef("");

  const trackGhost = (e: React.DragEvent) => {
    if (!ghostLabel.current) return;
    setGhost({ x: e.clientX + 14, y: e.clientY + 14, label: ghostLabel.current });
  };

  const readDraggedDoc = (e: React.DragEvent): string | null => {
    const id = e.dataTransfer.getData(KB_DOC_DRAG);
    return id || null;
  };

  const folderRow = (node: KbFolderNodeDto, depth: number) => (
    <FolderRow
      key={node.id}
      node={node}
      depth={depth}
      active={scopeFolderId === node.id}
      hovered={dragOverFolder === node.id}
      canWrite={canWrite}
      onScopeChange={props.onScopeChange}
      onDragOver={
        canWrite
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverFolder(node.id);
              trackGhost(e);
            }
          : undefined
      }
      onDragLeave={canWrite ? () => setDragOverFolder((v) => (v === node.id ? null : v)) : undefined}
      onDrop={
        canWrite
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverFolder(null);
              const docId = readDraggedDoc(e);
              if (docId) props.onMountDoc(docId, node.id);
            }
          : undefined
      }
      onCreate={() => props.onCreateFolder(node.id)}
      onRename={() => props.onRenameFolder(node.id)}
      onDelete={() => props.onDeleteFolder(node.id)}
      renderChildren={(n, d) => folderRow(n, d)}
    />
  );

  return (
    <div
      className="relative flex w-56 flex-none flex-col border-r border-line bg-bg1"
      onDragOver={trackGhost}
      onDragEnd={() => setGhost(null)}
      onDrop={() => setGhost(null)}
    >
      <div className="flex items-center justify-between border-b border-line px-2 py-1.5 text-[10px] text-tx3">
        <span>// 目录视图</span>
        {canWrite && (
          <button
            className="text-tx3 hover:text-acc"
            title="新建根目录"
            onClick={() => props.onCreateFolder(null)}
          >
            ＋
          </button>
        )}
      </div>

      {/* scope: 全部文档（扁平层） */}
      <button
        className={`flex items-center gap-1.5 px-2 py-1.5 text-left text-[11px] ${
          scopeFolderId === null ? "bg-bg2 text-acc" : "text-tx2 hover:bg-bg2 hover:text-tx"
        }`}
        onClick={() => props.onScopeChange(null)}
      >
        <span className="text-acc">●</span> 全部文档
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {tree.folders.length === 0 && (
          <div className="px-2 py-3 text-[10px] leading-relaxed text-tx3">
            // 暂无目录
            <br />
            // 目录只是分类视图，不持有文档
          </div>
        )}
        {tree.folders.map((n) => folderRow(n, 0))}
      </div>

      {/* 移除链接落区：仅当前选中目录下可见 */}
      {canWrite && scopeFolderId && (
        <div
          className={`m-2 rounded border border-dashed px-2 py-2 text-center text-[10px] ${
            overDropZone
              ? "border-err bg-err/10 text-err"
              : "border-line text-tx3"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setOverDropZone(true);
            trackGhost(e);
          }}
          onDragLeave={() => setOverDropZone(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOverDropZone(false);
            const docId = readDraggedDoc(e);
            if (docId) props.onUnlinkDoc(docId);
          }}
        >
          ⌫ 拖到此处移除链接
          <div className="mt-0.5 text-tx3">// 仅解除挂载，文档本体保留</div>
        </div>
      )}

      {/* 拖拽跟随标签：等宽体 mv 命令字样 */}
      {ghost && (
        <div
          className="pointer-events-none fixed z-50 rounded border border-acc bg-bg px-2 py-1 text-[10px] text-acc"
          style={{ left: ghost.x, top: ghost.y, boxShadow: "0 0 12px #00E59B22" }}
        >
          {ghost.label}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  node: KbFolderNodeDto;
  depth: number;
  active: boolean;
  hovered: boolean;
  canWrite: boolean;
  onScopeChange: (folderId: string) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  onCreate: () => void;
  onRename: () => void;
  onDelete: () => void;
  renderChildren: (n: KbFolderNodeDto, depth: number) => React.ReactNode;
}

function FolderRow(p: RowProps) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div
        className={`group flex cursor-pointer items-center gap-1 px-2 py-1 text-[11px] ${
          p.active ? "bg-bg2 text-acc" : "text-tx2 hover:bg-bg2 hover:text-tx"
        } ${p.hovered ? "outline outline-1 outline-acc" : ""}`}
        style={p.hovered ? { boxShadow: "0 0 12px #00E59B22" } : undefined}
        onClick={() => p.onScopeChange(p.node.id)}
        onDragOver={p.onDragOver}
        onDragLeave={p.onDragLeave}
        onDrop={p.onDrop}
        title={`${p.node.name}/ · ${p.node.docCount} 篇挂载`}
      >
        <span style={{ paddingLeft: p.depth * 12 }} />
        <button
          className="flex-none text-tx3 hover:text-acc"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          {open ? "▾" : "▸"}
        </button>
        <span className="min-w-0 flex-1 truncate">{p.node.name}/</span>
        <span className="flex-none text-[9px] text-tx3">{p.node.docCount}</span>
        {p.canWrite && (
          <span className="invisible flex flex-none items-center gap-1 group-hover:visible">
            <button
              className="text-tx3 hover:text-acc"
              title="新建子目录"
              onClick={(e) => {
                e.stopPropagation();
                p.onCreate();
              }}
            >
              ＋
            </button>
            <button
              className="text-tx3 hover:text-acc"
              title="重命名"
              onClick={(e) => {
                e.stopPropagation();
                p.onRename();
              }}
            >
              ✎
            </button>
            <button
              className="text-tx3 hover:text-err"
              title="删除目录（仅删视图与映射，文档保留）"
              onClick={(e) => {
                e.stopPropagation();
                p.onDelete();
              }}
            >
              ✗
            </button>
          </span>
        )}
      </div>
      {open && p.node.children.map((c) => p.renderChildren(c, p.depth + 1))}
    </div>
  );
}
```

- [ ] **Step 7.2: 构建验证**

Run: `pnpm --filter @aiwb/web build`
Expected: 编译通过（组件尚未被引用不应报 unused 错误；若 tsconfig noUnusedLocals 报错属预期外，需排查）。

- [ ] **Step 7.3: Commit**

```bash
git add apps/web/src/features/kb/KbTreeView.tsx
git commit -m "feat(kb): 终端风目录树组件 + 拖拽挂载/移除链接落区"
```

---

### Task 8: KbPanel 集成树形视图

**Files:**
- Modify: `apps/web/src/features/kb/KbPanel.tsx`

- [ ] **Step 8.1: imports 与新状态**

第 2 行类型 import 扩展：

```tsx
import type {
  KbAskMode, KbAskResultDto, KbDocumentDto, KbFolderTreeDto,
} from "@aiwb/shared";
```

文件顶部 import 新增：

```tsx
import { KB_DOC_DRAG, KbTreeView } from "./KbTreeView";
```

组件内（`const [docsError, ...]` 之后）新增目录树状态：

```tsx
  const [tree, setTree] = useState<KbFolderTreeDto>({ folders: [], links: [] });
  /** 检索范围：null=全部文档（扁平层）；目录 id=该目录（含子目录）挂载的文档 */
  const [scopeFolderId, setScopeFolderId] = useState<string | null>(null);
  const [dragDoc, setDragDoc] = useState<string | null>(null);
```

- [ ] **Step 8.2: 树加载与刷新**

`reload` 之后新增：

```tsx
  const reloadTree = useCallback(async () => {
    try {
      setTree(await api<KbFolderTreeDto>("/kb/folders"));
    } catch {
      // 目录视图加载失败不阻塞文档列表，静默保留旧数据
    }
  }, []);

  useEffect(() => {
    void reloadTree();
  }, [reloadTree]);
```

`reload` 的两处调用后（`ingest` 成功分支、`removeDoc`/`retryDoc`）同步 `await reloadTree()`（挂载数会变）。

- [ ] **Step 8.3: 目录操作回调**

在 `retryDoc` 之后新增：

```tsx
  /** 展平目录树（用于上传表单的主归属下拉） */
  const flatFolders = (() => {
    const out: { id: string; label: string }[] = [];
    const walk = (nodes: typeof tree.folders, prefix: string) => {
      for (const n of nodes) {
        out.push({ id: n.id, label: `${prefix}${n.name}/` });
        walk(n.children, `${prefix}${n.name}/`);
      }
    };
    walk(tree.folders, "");
    return out;
  })();

  /** 当前范围（含子目录）挂载的 docId 集合 */
  const scopeDocIds = (() => {
    if (scopeFolderId === null) return null;
    const ids = new Set<string>([scopeFolderId]);
    const collect = (nodes: typeof tree.folders) => {
      for (const n of nodes) {
        if (ids.has(n.parentId ?? "") || ids.has(n.id)) {
          if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
          collect(n.children);
        }
      }
    };
    const walk = (nodes: typeof tree.folders) => {
      for (const n of nodes) {
        if (ids.has(n.id)) for (const c of n.children) { ids.add(c.id); }
        walk(n.children);
      }
    };
    walk(tree.folders);
    return new Set(
      tree.links.filter((l) => ids.has(l.folderId)).map((l) => l.documentId),
    );
  })();

  const createFolder = async (parentId: string | null) => {
    const name = window.prompt("目录名：");
    if (!name?.trim()) return;
    await api("/kb/folders", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), ...(parentId ? { parentId } : {}) }),
    });
    await reloadTree();
  };

  const renameFolder = async (folderId: string) => {
    const name = window.prompt("新目录名：");
    if (!name?.trim()) return;
    await api(`/kb/folders/${folderId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: name.trim() }),
    });
    await reloadTree();
  };

  /** 删除目录：仅删视图与映射，文档本体/向量保留 */
  const deleteFolder = async (folderId: string) => {
    if (!window.confirm("删除目录将同时解除其下所有挂载链接（文档本体与向量保留），确认？")) return;
    await api(`/kb/folders/${folderId}`, { method: "DELETE" });
    if (scopeFolderId) setScopeFolderId(null);
    await reloadTree();
  };

  /** 拖拽挂载：一份文档可挂多个目录，重复挂载服务端幂等 */
  const mountDoc = async (docId: string, folderId: string) => {
    try {
      await api("/kb/links", {
        method: "POST",
        body: JSON.stringify({ documentId: docId, folderId }),
      });
      await reloadTree();
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    }
  };

  /** 移除链接：仅删映射行，文档本体/向量保留 */
  const unlinkDocFromScope = async (docId: string) => {
    if (scopeFolderId === null) return;
    const link = tree.links.find(
      (l) => l.documentId === docId && l.folderId === scopeFolderId,
    );
    if (!link) return;
    try {
      await api(`/kb/links/${link.id}`, { method: "DELETE" });
      await reloadTree();
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    }
  };
```

- [ ] **Step 8.4: ingest 传主归属目录**

上传表单 `title` label 之前插入目录选择（主归属 = 原始上传路径，写入 chunk primary_path）：

```tsx
                <label className="mb-3 flex items-center gap-2">
                  <span className="w-20 flex-none text-tx3">folder:</span>
                  <select
                    className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none focus:border-acc"
                    value={form.folderId ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, folderId: e.target.value || undefined }))
                    }
                  >
                    <option value="">（未归类 ~/kb/）</option>
                    {flatFolders.map((f) => (
                      <option key={f.id} value={f.id}>
                        ~/kb/{f.label}
                      </option>
                    ))}
                  </select>
                </label>
```

`form` 状态改为 `useState<{ title: string; content: string; folderId?: string }>({ title: "", content: "" })`；`ingest` 的 body 改为 `JSON.stringify({ title, content, ...(form.folderId ? { folderId: form.folderId } : {}) })`；成功分支 `setForm({ title: "", content: "" })` 后追加 `await reloadTree();`；`pickFiles` 的 `setForm({ title: file.name, content })` 保持不变（folderId 默认空）。

- [ ] **Step 8.5: docs Tab 换为树 + 文档列表双栏**

docs Tab 分支整体替换为：

```tsx
      ) : (
        /* 文档管理页：左目录树（视图层） + 右文档列表（存储层，扁平一份） */
        <div className="flex min-h-0 flex-1">
          <KbTreeView
            tree={tree}
            scopeFolderId={scopeFolderId}
            canWrite={canWrite}
            onScopeChange={setScopeFolderId}
            onMountDoc={(docId, folderId) => void mountDoc(docId, folderId)}
            onUnlinkDoc={(docId) => void unlinkDocFromScope(docId)}
            onCreateFolder={(parentId) => void createFolder(parentId)}
            onRenameFolder={(id) => void renameFolder(id)}
            onDeleteFolder={(id) => void deleteFolder(id)}
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto w-[min(760px,100%)]">
              {/* 范围指示：机器检索层始终扁平，范围只是视图过滤 */}
              <div className="mb-3 flex items-center gap-2 text-[10px] text-tx3">
                <span>scope:</span>
                <span className={scopeFolderId ? "text-acc" : "text-tx2"}>
                  {scopeFolderId
                    ? `~/kb/${flatFolders.find((f) => f.id === scopeFolderId)?.label ?? ""}`
                    : "全部文档（全局扁平召回）"}
                </span>
                {scopeFolderId && (
                  <button className="text-tx3 hover:text-acc" onClick={() => setScopeFolderId(null)}>
                    × 清除范围
                  </button>
                )}
              </div>

              {/* 上传表单（原 showAdd 表单整体保留，仅 folder select 为新增） */}
              {showAdd && ( /* ……原表单 JSX，含 Step 8.4 的 folder select…… */ )}

              {docsError && (
                <div className="mb-3 rounded border border-err/50 bg-bg1 px-3 py-2 text-[12px] text-err">
                  ✗ {docsError}
                </div>
              )}

              <div className="overflow-hidden rounded-lg border border-line bg-bg1">
                <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] text-tx3">
                  <span>~/kb · {scopeDocIds ? `${scopeDocIds.size} 篇挂载` : `${docs.length} 篇`}</span>
                  <span>拖文档到左侧目录挂载 · 一份文档可挂多个目录</span>
                </div>
                {inScopeDocs.length === 0 ? (
                  <div className="px-4 py-12 text-center text-[12px] text-tx3">
                    // {scopeFolderId ? "该目录下暂无挂载文档 —— 把右侧/全部文档拖进来" : "知识库为空 —— 点击右上角「选文件」或「粘贴文本」"}
                  </div>
                ) : (
                  <div className="py-1">
                    {inScopeDocs.map((d, i) => (
                      <div
                        key={d.id}
                        className={`group flex cursor-pointer items-center gap-3 px-3 py-2 text-[12px] hover:bg-bg2 ${
                          dragDoc === d.id ? "opacity-40" : ""
                        }`}
                        draggable={canWrite}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(KB_DOC_DRAG, d.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragDoc(d.id);
                        }}
                        onDragEnd={() => setDragDoc(null)}
                        onClick={() => void viewOriginal(d)}
                        role="button"
                        tabIndex={0}
                        title="点击查看归档原文；可拖到左侧目录挂载"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void viewOriginal(d);
                        }}
                      >
                        <span className="text-tx3">{i === inScopeDocs.length - 1 ? "└──" : "├──"}</span>
                        <span className={STATUS_DOT[d.status]}>●</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-tx">{d.title}</span>
                          <span className="block truncate text-[10px] text-tx3">
                            {d.path} · {humanSize(d.size)} · {d.chunkCount} chunks · {STATUS_LABEL[d.status]}
                            {mountCount(d.id) > 1 && ` · ⛓ ${mountCount(d.id)} 目录挂载`}
                          </span>
                          {d.status === "error" && d.error && (
                            <span className="block truncate text-[10px] text-err">{d.error}</span>
                          )}
                        </span>
                        {canWrite && (
                          <span className="invisible flex items-center gap-2 group-hover:visible">
                            <button
                              className="text-[11px] text-tx3 hover:text-acc"
                              onClick={(e) => {
                                e.stopPropagation();
                                void viewOriginal(d);
                              }}
                              title="查看归档原文"
                            >
                              👁 原文
                            </button>
                            {d.status === "error" && (
                              <button
                                className="text-[11px] text-tx3 hover:text-acc"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void retryDoc(d);
                                }}
                                title="从归档原文重新切分/向量化"
                              >
                                ↻ 重试
                              </button>
                            )}
                            {scopeFolderId && (
                              <button
                                className="text-[11px] text-tx3 hover:text-warn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void unlinkDocFromScope(d.id);
                                }}
                                title="移除链接：仅解除当前目录挂载，文档本体与向量保留"
                              >
                                ✂ 移除链接
                              </button>
                            )}
                            <button
                              className="text-[11px] text-tx3 hover:text-err"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!window.confirm(`删除文档本体？《${d.title}》将从所有目录消失，向量切片一并清除。`)) return;
                                void removeDoc(d);
                              }}
                              title="删除文档本体：源文件+全部向量+所有目录挂载"
                            >
                              ✗ 删除
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )
```

- [ ] **Step 8.6: 范围过滤与挂载计数辅助函数**

组件内（`humanSize` 之后的模块级或组件内均可，放组件内）新增：

```tsx
  /** 当前范围内可见的文档：null=全部；目录范围=挂载集合（含子目录） */
  const inScopeDocs = scopeDocIds
    ? docs.filter((d) => scopeDocIds.has(d.id))
    : docs;

  /** 该文档被挂载的目录数（>1 显示 ⛓ 徽标，提示软链接多挂载） */
  const mountCount = (docId: string) =>
    tree.links.filter((l) => l.documentId === docId).length;
```

（注意：`inScopeDocs` / `mountCount` 需定义在 Step 8.3 的 `scopeDocIds` 之后；JSX 中引用的顺序在函数组件内无影响。）

- [ ] **Step 8.7: chat Tab 范围徽标**

chat Tab 空状态提示块（`turns.length === 0` 分支）中，`// 试试：…` 之前加一行：

```tsx
                  {scopeFolderId !== null && (
                    <div className="mb-1 text-[10px] text-warn">
                      // 问答为全局检索，不受目录范围限制（范围仅作用于目录检索）
                    </div>
                  )}
```

- [ ] **Step 8.8: 构建验证**

Run: `pnpm --filter @aiwb/shared build && pnpm --filter @aiwb/web build`
Expected: 编译通过。

- [ ] **Step 8.9: Commit**

```bash
git add apps/web/src/features/kb/KbPanel.tsx
git commit -m "feat(kb): docs Tab 树形视图集成 + 拖拽挂载/移除链接/范围检索"
```

---

### Task 9: 端到端验证 + 开发日志

**Files:**
- Create: `docs/devlog/080-kb-softlink-tree.md`

- [ ] **Step 9.1: 全量构建**

Run: `make build`
Expected: shared / server / web 全部编译通过。

- [ ] **Step 9.2: API 链路手测（核心验收）**

启动 `make dev`，登录获取 token 后依次验证（`$H` 为 `-H "authorization: Bearer $TOKEN"`）：

```bash
# 1. 建目录树：部署手册/网络
curl -s -X POST localhost:8700/api/kb/folders $H -H 'content-type: application/json' -d '{"name":"部署手册"}'
curl -s -X POST localhost:8700/api/kb/folders $H -H 'content-type: application/json' -d '{"name":"网络","parentId":"<部署手册id>"}'
# 2. 上传文档（主归属=部署手册）
curl -s -X POST localhost:8700/api/kb/documents $H -H 'content-type: application/json' \
  -d '{"title":"qdrant配置.md","content":"qdrant 6333 端口配置说明……","folderId":"<部署手册id>"}'
# 3. 挂到第二个目录（网络/），验证多对多
curl -s -X POST localhost:8700/api/kb/links $H -H 'content-type: application/json' \
  -d '{"documentId":"<docId>","folderId":"<网络id>"}'
# 4. 目录范围检索命中
curl -s -X POST localhost:8700/api/kb/search $H -H 'content-type: application/json' \
  -d '{"query":"qdrant","folderId":"<部署手册id>"}'
# 5. 移除链接 → 范围检索不再命中、全局仍命中、文档还在
curl -s -X DELETE localhost:8700/api/kb/links/<linkId> $H
curl -s -X POST localhost:8700/api/kb/search $H -H 'content-type: application/json' -d '{"query":"qdrant","folderId":"<部署手册id>"}'   # hits 空
curl -s -X POST localhost:8700/api/kb/search $H -H 'content-type: application/json' -d '{"query":"qdrant"}'                          # 命中
# 6. 删除目录 → 文档仍在列表
curl -s -X DELETE localhost:8700/api/kb/folders/<部署手册id> $H
curl -s localhost:8700/api/kb/documents $H   # 文档仍在
# 7. 删除文档本体 → 切片清零、所有视图消失
curl -s -X DELETE localhost:8700/api/kb/documents/<docId> $H
curl -s localhost:8700/api/kb/documents $H   # 文档消失
curl -s -X POST localhost:8700/api/collections/kb_chunks_d256/points/count \
  -d '{"filter":{"must":[{"key":"doc_id","match":{"value":"<docId>"}}]}}' http://localhost:6333  # count=0
```

Expected: 每步与注释一致；LightRAG 链路（`KB_PROVIDER=lightrag`）时第 4 步返回 `scopeFiltered: true`。

- [ ] **Step 9.3: 前端手测**

Run: `make dev-web`，浏览器打开 `http://localhost:8701` 进入 KB 面板 docs Tab。
验证：树形折叠/展开；拖文档到目录行（绿描边辉光 + `mv` 跟随标签）→ 挂载计数 +1；拖到「⌫ 移除链接」落区 → 链接解除、文档仍在「全部文档」；「移除链接」与「删除」按钮分离且有二次确认文案；上传表单可选主归属目录。

- [ ] **Step 9.4: 写开发日志**

创建 `docs/devlog/080-kb-softlink-tree.md`（遵循 `docs/devlog/README.md` 模板；编号按 devlog 现状顺延，现有最新为 079）：

```markdown
# 080 · KB 扁平存储 + 软链接树形视图

- 日期：2026-11-08
- 状态：已完成

## 目标
知识库采用「底层扁平存储 + 上层软链接树形视图」分离架构：文档与向量始终扁平一份，目录只是视图容器；支持多对多挂载、移除链接/删除本体语义分离、全局与目录范围双模式检索。

## 决策
- 目录/映射拆两张表（kb_folders + kb_links），否决单表 tree_nodes（树结构与引用语义混合，删除语义不清晰）与传统 folder_id 硬绑定。
- 目录范围检索仅 Qdrant 原生支持（doc_id match any）；LightRAG 全局召回后应用层过滤并返回 scopeFiltered 标记。
- 主归属目录本期启用：chunk payload 增 primary_path 路径语义增强；存量文档不回填向量。
- kb.ask 本期保持全局问答；前端 chat Tab 仅显示范围徽标提示。
- 前端用 HTML5 DnD（自定义 MIME text/x-kb-doc-id），避免与文件上传拖拽冲突。

## 实现
- 类型/协议：packages/shared/src/kb.ts（目录/链接/范围检索类型）、operations.ts KB_OPERATIONS。
- Schema：apps/server/src/db/schema.ts kb_folders / kb_links（UNIQUE(document_id, folder_id)）、kb_documents.primaryFolderId。
- 服务层：apps/server/src/kb/kb.service.ts（目录 CRUD 防环、挂载/移除、folderSubtreeIds 范围解析、删除文档清理全部映射）。
- 向量层：apps/server/src/kb/qdrant.service.ts（payload primary_path、search docIds 过滤）。
- 路由：apps/server/src/kb/kb.controller.ts（folders/links CRUD、search folderId）。
- 工具：apps/server/src/tools/kb.tools.ts（kb.search，search.multi 保持全局语义）。
- 前端：apps/web/src/features/kb/KbTreeView.tsx（终端风文件树 + 拖拽挂载/移除落区/mv 跟随标签）、KbPanel.tsx（双栏布局、范围指示、主归属下拉）。

## 验证
- make build 全部通过；API 链路手测 7 步（建树→上传→双挂载→范围检索→移除链接→删目录→删本体，切片 count=0）。
- 前端手测拖拽挂载/移除/二次确认/范围切换。

## 遗留
- 存量文档 primary_path 向量回填。
- kb.ask 目录范围问答。
- 移动端树形视图手势（061 mobileView 下的拖拽适配）。
- capability 意图路由手册未含 kb.search 说明。
```

- [ ] **Step 9.5: Commit**

```bash
git add docs/devlog/080-kb-softlink-tree.md
git commit -m "docs(devlog): 080 KB 软链接树形视图开发日志"
```

---

## 计划自审记录

- **Spec 覆盖**：spec 六条核心需求均有对应任务——扁平存储+视图分离（Task 2/4）、多对多挂载（Task 4.3 mountDocument）、两类操作区分（Task 4.4/4.7/5/8.5 按钮文案）、双模式检索（Task 3/4.6）、主归属（Task 4.4/4.5/8.4）、边界约定（目录不向量化——无任何向量化逻辑涉及 kb_folders，检索过滤只走 kb_links）。
- **一致性**：`KB_DOC_DRAG`、`KbFolderTreeDto`、`scopeFiltered`、`primaryFolderId` 等符号在前后端任务间命名一致；`processDocument` 第五参默认值保证 retryIngest 旧调用兼容。
- **已知取舍**：LightRAG 路径范围过滤可能少于 topK（spec 已声明）；存量向量无 primary_path（字段可选）。
