import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384, r = 8, p = 1, KEYLEN = 64;

/** 格式: scrypt:N:r:p$salt_hex$hash_hex —— 用 node 内置 scrypt，避免 bcrypt 原生依赖 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN, { N, r, p });
  return `scrypt:${N}:${r}:${p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [meta, saltHex, hashHex] = stored.split("$");
  const [, nS, rS, pS] = meta.split(":");
  const expect = Buffer.from(hashHex, "hex");
  const actual = scryptSync(plain, Buffer.from(saltHex, "hex"), expect.length, {
    N: Number(nS), r: Number(rS), p: Number(pS),
  });
  return timingSafeEqual(expect, actual);
}
