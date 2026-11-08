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
            overDropZone ? "border-err bg-err/10 text-err" : "border-line text-tx3"
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
