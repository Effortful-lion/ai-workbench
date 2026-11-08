/**
 * 存量文件迁移：本地 data/uploads（知识库原文）与 data/toolbox（工具箱二进制）→ MinIO。
 * 幂等：已存在且大小一致的对象跳过。只上传不删本地文件，验证无误后可手动清理。
 *
 * 用法：cd apps/server && node scripts/migrate-to-minio.mjs [--delete]
 *   --delete  上传校验成功后删除本地源文件
 */
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "minio";

const ROOT = resolve(process.cwd(), "../../data");
const SOURCES = [
  { dir: join(ROOT, "uploads"), bucket: process.env.MINIO_BUCKET_KB ?? "aiwb-kb", label: "kb" },
  { dir: join(ROOT, "toolbox"), bucket: process.env.MINIO_BUCKET_FILES ?? "aiwb-files", label: "files" },
];

const client = new Client({
  endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_PORT ?? 9700),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY ?? "admin",
  secretKey: process.env.MINIO_SECRET_KEY ?? "admin123",
});

const DELETE = process.argv.includes("--delete");

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // 目录不存在
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

async function objectExists(bucket, key, size) {
  try {
    const s = await client.statObject(bucket, key);
    return s.size === size;
  } catch {
    return false;
  }
}

let uploaded = 0;
let skipped = 0;
let failed = 0;
const failures = [];

for (const src of SOURCES) {
  if (!(await client.bucketExists(src.bucket))) {
    await client.makeBucket(src.bucket);
    console.log(`created bucket ${src.bucket}`);
  }
  for await (const filePath of walk(src.dir)) {
    // key = 相对 data/<dir> 的两级路径：<ownerOrId>/<fileName>
    const rel = filePath.slice(src.dir.length + 1).split("/").join("/");
    const { size } = await stat(filePath);
    try {
      if (await objectExists(src.bucket, rel, size)) {
        skipped += 1;
        continue;
      }
      const body = await readFile(filePath);
      await client.putObject(src.bucket, rel, body, body.length);
      uploaded += 1;
      console.log(`↑ ${src.bucket}/${rel} (${size}B)`);
      if (DELETE) await rm(filePath, { force: true });
    } catch (e) {
      failed += 1;
      failures.push(`${rel}: ${e.message}`);
    }
  }
}

console.log(`\n完成：上传 ${uploaded}，跳过（已存在）${skipped}，失败 ${failed}`);
if (failures.length) {
  console.log("失败明细：");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exitCode = 1;
}
if (!DELETE) console.log("本地源文件未删除；验证 MinIO 数据无误后可加 --delete 重跑或直接手动删除。");
