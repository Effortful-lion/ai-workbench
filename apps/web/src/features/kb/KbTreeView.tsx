import { useEffect, useRef, useState } from "react";
import type { KbDocumentDto, KbFolderNodeDto, KbFolderTreeDto } from "@aiwb/shared";

/** 拖拽数据类型（自定义 MIME，避免与文件上传拖拽冲突） */
export const KB_DOC_DRAG = "text/x-kb-doc-id";

const STATUS_DOT: Record<KbDocumentDto["status"], string> = {
  embedded: "text-acc",
  pending: "text-warn",
  error: "text-err",
};

interface Props {
  tree: KbFolderTreeDto;
  /** 扁平文档列表：目录展开时把挂载文档渲染为树叶子节点 */
  docs: KbDocumentDto[];
  scopeFolderId: string | null;
  canWrite: boolean;
  /** 正被拖拽的文档标题；null=无内部拖拽（跟随标签隐藏） */
  dragLabel: string | null;
  onScopeChange: (folderId: string | null) => void;
  onMountDoc: (docId: string, folderId: string) => void;
  /** 拖到「⌫ 移除链接」落区触发：仅解除该文档与当前目录的挂载 */
  onUnlinkDoc: (docId: string) => void;
  /** 内联表单提交（不再用 window.prompt）：parentId=null=根目录 */
  onCreateFolder: (parentId: string | null, name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  /** 点击树中叶子文档 → 查看归档原文 */
  onDocOpen: (docId: string) => void;
  /** 树内文档拖拽起止：同步到面板 dragDoc 状态（跟随标签 / 源行淡出） */
  onDocDrag: (docId: string | null) => void;
}

/** 终端风目录树：`▸/▾` 折叠（展开可见挂载文档叶子）、等宽体路径；
 *  拖文档到目录挂载，拖到底部落区移除链接；目录新建/重命名为内联表单。
 *  视觉规范：悬停终端绿描边 + 辉光（box-shadow 0 0 12px #00E59B22），落点 ▌ 样式。 */
export default function KbTreeView(props: Props) {
  const { tree, docs, scopeFolderId, canWrite } = props;
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [overDropZone, setOverDropZone] = useState(false);
  /** 内联新建：undefined=关闭 / null=根目录 / 字符串=该目录下新建 */
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // 跟随标签：位置直写 DOM transform（不触发 React 重渲染），仅文本走状态
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const [ghostText, setGhostText] = useState<string | null>(null);
  const ghostLabel = useRef("");

  // 拖拽结束（dragLabel 置空）时隐藏跟随标签
  useEffect(() => {
    if (!props.dragLabel) {
      ghostLabel.current = "";
      setGhostText(null);
      if (ghostRef.current) ghostRef.current.style.opacity = "0";
    }
  }, [props.dragLabel]);

  /** 跟随标签：等宽体 mv 命令字样，目标随悬停位置实时变化 */
  const trackGhost = (e: React.DragEvent) => {
    if (!props.dragLabel) return;
    const target = overDropZone
      ? "⌫ 移除链接"
      : dragOverFolder
        ? `${findFolderName(tree.folders, dragOverFolder) ?? "?"}/`
        : "…";
    const label = `mv ${props.dragLabel} → ${target}`;
    if (label !== ghostLabel.current) {
      ghostLabel.current = label;
      setGhostText(label);
    }
    const el = ghostRef.current;
    if (el) {
      el.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
      el.style.opacity = "1";
    }
  };

  const readDraggedDoc = (e: React.DragEvent): string | null => {
    const id = e.dataTransfer.getData(KB_DOC_DRAG);
    return id || null;
  };

  /** 每个目录直接挂载的文档（树叶子） */
  const docsOf = (folderId: string) => {
    const ids = new Set(tree.links.filter((l) => l.folderId === folderId).map((l) => l.documentId));
    return docs.filter((d) => ids.has(d.id));
  };

  const submitCreate = (name: string) => {
    const parent = creatingParentId ?? null;
    setCreatingParentId(undefined);
    if (name) props.onCreateFolder(parent, name);
  };

  const folderRow = (node: KbFolderNodeDto, depth: number) => (
    <FolderRow
      key={node.id}
      node={node}
      depth={depth}
      active={scopeFolderId === node.id}
      hovered={dragOverFolder === node.id}
      canWrite={canWrite}
      docsHere={docsOf(node.id)}
      renaming={renamingId === node.id}
      creatingHere={creatingParentId === node.id}
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
      onStartCreateChild={() => setCreatingParentId(node.id)}
      onStartRename={() => setRenamingId(node.id)}
      onDelete={() => props.onDeleteFolder(node.id)}
      onCreateSubmit={submitCreate}
      onCancelCreate={() => setCreatingParentId(undefined)}
      onRenameSubmit={(name) => {
        setRenamingId(null);
        if (name) props.onRenameFolder(node.id, name);
      }}
      onDocOpen={props.onDocOpen}
      onDocDrag={props.onDocDrag}
      renderRow={(n, d) => folderRow(n, d)}
    />
  );

  return (
    <div className="relative flex w-56 flex-none flex-col border-r border-line bg-bg1">
      <div className="flex items-center justify-between border-b border-line px-2 py-1.5 text-[10px] text-tx3">
        <span>// 目录视图</span>
        {canWrite && (
          <button
            className="text-tx3 hover:text-acc"
            title="新建根目录"
            onClick={() => setCreatingParentId(null)}
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
        {tree.folders.length === 0 && creatingParentId !== null && (
          <div className="px-2 py-3 text-[10px] leading-relaxed text-tx3">
            // 暂无目录
            <br />
            // 目录只是分类视图，不持有文档
          </div>
        )}
        {creatingParentId === null && (
          <NewFolderInput depth={0} onSubmit={submitCreate} onCancel={() => setCreatingParentId(undefined)} />
        )}
        {tree.folders.map((n) => folderRow(n, 0))}
      </div>

      {/* 移除链接落区：仅当前选中目录下可见 */}
      {canWrite && scopeFolderId && (
        <div
          className={`m-2 rounded border border-dashed px-2 py-2 text-center text-[10px] transition-colors duration-150 ${
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
            e.stopPropagation();
            setOverDropZone(false);
            const docId = readDraggedDoc(e);
            if (docId) props.onUnlinkDoc(docId);
          }}
        >
          ⌫ 拖到此处移除链接
          <div className="mt-0.5 text-tx3">// 仅解除挂载，文档本体保留</div>
        </div>
      )}

      {/* 拖拽跟随标签：常驻 DOM，位置经 transform 直写保证平滑跟随 */}
      <div
        ref={ghostRef}
        className={`pointer-events-none fixed left-0 top-0 z-50 rounded border border-acc bg-bg px-2 py-1 text-[10px] text-acc transition-opacity duration-150 ${
          ghostText ? "" : "opacity-0"
        }`}
        style={{ transform: "translate(-200px,-200px)", boxShadow: "0 0 12px #00E59B22" }}
      >
        {ghostText}
      </div>
    </div>
  );
}

/** 在树中查找目录名（用于跟随标签的目标显示） */
function findFolderName(nodes: KbFolderNodeDto[], id: string): string | null {
  for (const n of nodes) {
    if (n.id === id) return n.name;
    const found = findFolderName(n.children, id);
    if (found) return found;
  }
  return null;
}

/** 内联新建目录输入：终端风 `▌` 光标，⏎ 确认 / Esc 或失焦取消 */
function NewFolderInput(p: {
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="flex items-center gap-1 py-1 pr-2 text-[11px]" style={{ paddingLeft: p.depth * 12 + 10 }}>
      <span className="flex-none text-acc">▌</span>
      <input
        ref={ref}
        value={value}
        placeholder="目录名 ⏎ / Esc"
        className="min-w-0 flex-1 border-b border-acc bg-transparent text-acc outline-none placeholder:text-tx3"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) p.onSubmit(value.trim());
          else if (e.key === "Escape") p.onCancel();
        }}
        onBlur={() => p.onCancel()}
      />
    </div>
  );
}

/** 内联重命名输入：初始为当前目录名 */
function RenameInput(p: {
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(p.initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  return (
    <input
      ref={ref}
      value={value}
      className="min-w-0 flex-1 border-b border-acc bg-transparent text-acc outline-none"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && value.trim() && value.trim() !== p.initial) p.onSubmit(value.trim());
        else if (e.key === "Escape") p.onCancel();
      }}
      onBlur={() => p.onCancel()}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

interface RowProps {
  node: KbFolderNodeDto;
  depth: number;
  active: boolean;
  hovered: boolean;
  canWrite: boolean;
  docsHere: KbDocumentDto[];
  renaming: boolean;
  creatingHere: boolean;
  onScopeChange: (folderId: string) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  onStartCreateChild: () => void;
  onStartRename: () => void;
  onDelete: () => void;
  onCreateSubmit: (name: string) => void;
  onCancelCreate: () => void;
  onRenameSubmit: (name: string) => void;
  onDocOpen: (docId: string) => void;
  onDocDrag: (docId: string | null) => void;
  renderRow: (n: KbFolderNodeDto, depth: number) => React.ReactNode;
}

function FolderRow(p: RowProps) {
  const [openInternal, setOpenInternal] = useState(true);
  // 新建子目录 / 重命名时强制展开，保证表单可见
  const open = p.creatingHere || p.renaming ? true : openInternal;
  const leaves = p.docsHere;
  return (
    <div>
      <div
        className={`group flex cursor-pointer items-center gap-1 px-2 py-1 text-[11px] transition-all duration-150 ${
          p.active ? "bg-bg2 text-acc" : "text-tx2 hover:bg-bg2 hover:text-tx"
        } ${p.hovered ? "outline outline-1 outline-acc" : ""}`}
        style={p.hovered ? { boxShadow: "0 0 12px #00E59B22" } : undefined}
        onClick={() => p.onScopeChange(p.node.id)}
        onDragOver={p.onDragOver}
        onDragLeave={p.onDragLeave}
        onDrop={p.onDrop}
        title={`${p.node.name}/ · ${p.node.docCount} 篇挂载（展开可查看）`}
      >
        <span style={{ paddingLeft: p.depth * 12 }} />
        <button
          className="flex-none text-tx3 hover:text-acc"
          onClick={(e) => {
            e.stopPropagation();
            setOpenInternal((v) => !v);
          }}
        >
          {open ? "▾" : "▸"}
        </button>
        {p.renaming ? (
          <RenameInput
            initial={p.node.name}
            onSubmit={p.onRenameSubmit}
            onCancel={() => p.onRenameSubmit("")}
          />
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">{p.node.name}/</span>
            <span className="flex-none text-[9px] text-tx3">{p.node.docCount}</span>
            {p.canWrite && (
              <span className="invisible flex flex-none items-center gap-1 group-hover:visible">
                <button
                  className="text-tx3 hover:text-acc"
                  title="新建子目录"
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onStartCreateChild();
                  }}
                >
                  ＋
                </button>
                <button
                  className="text-tx3 hover:text-acc"
                  title="重命名"
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onStartRename();
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
          </>
        )}
      </div>
      {open && (
        <>
          {p.creatingHere && (
            <NewFolderInput
              depth={p.depth + 1}
              onSubmit={p.onCreateSubmit}
              onCancel={p.onCancelCreate}
            />
          )}
          {p.node.children.map((c) => p.renderRow(c, p.depth + 1))}
          {/* 挂载文档叶子：点击看原文，可拖到其他目录挂载 */}
          {leaves.length > 0 &&
            leaves.map((d, i) => (
              <div
                key={d.id}
                className="flex cursor-pointer items-center gap-1 py-0.5 pr-2 text-[10px] text-tx3 hover:text-tx2"
                style={{ paddingLeft: (p.depth + 1) * 12 + 10 }}
                draggable={p.canWrite}
                onDragStart={(e) => {
                  e.dataTransfer.setData(KB_DOC_DRAG, d.id);
                  e.dataTransfer.effectAllowed = "move";
                  p.onDocDrag(d.id);
                }}
                onDragEnd={() => p.onDocDrag(null)}
                onClick={() => p.onDocOpen(d.id)}
                title={`${d.path} · 点击查看原文${p.canWrite ? "，可拖到其他目录挂载" : ""}`}
              >
                <span className="flex-none text-tx3">
                  {p.node.children.length === 0 && i === leaves.length - 1 ? "└─" : "├─"}
                </span>
                <span className={`flex-none ${STATUS_DOT[d.status]}`}>●</span>
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
