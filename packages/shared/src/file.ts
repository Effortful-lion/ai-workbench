/** 按扩展名推断常见文件 MIME：CLI 上传、工具上传、工具箱落库共用一份。 */
const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".zip": "application/zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export function mimeOfFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME_BY_EXT[fileName.slice(dot).toLowerCase()] ?? "application/octet-stream";
}
