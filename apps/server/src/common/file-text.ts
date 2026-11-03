import { BadRequestException } from "@nestjs/common";

export type FileTextSource = "pdf" | "docx" | "text";

interface UnpdfModule {
  getDocumentProxy(data: Uint8Array): Promise<unknown>;
  extractText(
    pdf: unknown,
    opts?: { mergePages?: boolean },
  ): Promise<{ text: string | string[] }>;
}

/** unpdf 是纯 ESM 包，Nest 编译产物是 CJS，只能通过原生 import() 加载 */
const importEsm = new Function("s", "return import(s)") as (
  specifier: string,
) => Promise<Record<string, unknown>>;

export function detectFileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** 从文件二进制里抽取纯文本：pdf → unpdf，docx → mammoth，txt/md 直接读。
 *  简历导入与工具侧 --file 共用，纯文本外的格式只在这里维护。 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string,
): Promise<{ text: string; source: FileTextSource }> {
  const ext = detectFileExt(fileName);
  if (ext === "pdf") {
    const unpdf = (await importEsm("unpdf")) as unknown as UnpdfModule;
    const pdf = await unpdf.getDocumentProxy(new Uint8Array(buffer));
    const result = await unpdf.extractText(pdf, { mergePages: true });
    return { text: Array.isArray(result.text) ? result.text.join("\n") : result.text, source: "pdf" };
  }
  if (ext === "docx") {
    // mammoth 未自带类型声明，这里按用到的 API 局部声明
    const mammoth = require("mammoth") as {
      extractRawText(input: { buffer: Buffer }): Promise<{ value?: string }>;
    };
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value ?? "", source: "docx" };
  }
  if (ext === "txt" || ext === "md" || ext === "markdown") {
    return { text: buffer.toString("utf8"), source: "text" };
  }
  if (ext === "doc") throw new BadRequestException("暂不支持旧版 .doc，请另存为 .docx 后重试");
  throw new BadRequestException("仅支持 .pdf / .docx / .txt / .md 文件");
}
