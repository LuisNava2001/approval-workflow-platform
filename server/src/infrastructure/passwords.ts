// Password hashing with scrypt from node:crypto. Format: scrypt$N$r$p$salt$hash (base64 parts).

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const COST = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;

export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  const hash = scryptSync(password, salt, KEY_LENGTH, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
