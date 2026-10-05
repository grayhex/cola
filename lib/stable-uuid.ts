import { createHash } from "node:crypto";

/**
 * A version-4-shaped UUID made of a seed: the same seed is always the same id,
 * and nobody can guess one from another. For identifiers that must come out
 * equal on a retry (an event from a message, an object from an idempotency key)
 * and must not be shared between people (put the person in the seed).
 */
export function stableUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = "89ab"[parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
