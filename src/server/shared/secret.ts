import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison. Hashing first makes the buffers equal length so length never leaks. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}
