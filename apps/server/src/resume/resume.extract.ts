import { BadRequestException } from "@nestjs/common";
import { MAX_IMPORT_CHARS } from "./resume.parser";
import { extractTextFromBuffer, type FileTextSource } from "../common/file-text";

/** 上传体积上限：10MB，足够一份常规简历 PDF/Word */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ResumeSource = FileTextSource;

/** multer 内存存储的文件对象（不引入 @types/multer，按需结构声明） */
export interface UploadedResumeFile {
  originalname?: string;
  mimetype?: string;
  buffer?: Buffer;
  size?: number;
}

/** 按扩展名从文件里抽取纯文本，再按简历场景给出更具体的空文本提示 */
export async function extractResumeText(
  file: UploadedResumeFile,
): Promise<{ text: string; source: ResumeSource }> {
  const buf = file.buffer;
  if (!buf || buf.length === 0) throw new BadRequestException("文件为空");
  if (buf.length > MAX_UPLOAD_BYTES) {
    throw new BadRequestException(`文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB，请压缩后再上传`);
  }

  const { text, source } = await extractTextFromBuffer(buf, file.originalname ?? "");
  const trimmed = text.replace(/\r\n?/g, "\n").trim();
  if (!trimmed) {
    throw new BadRequestException(
      "没能从文件里读到文字（可能是扫描版 PDF），请直接粘贴文本，或换一份可复制文字的简历",
    );
  }
  return { text: trimmed.slice(0, MAX_IMPORT_CHARS), source };
}
