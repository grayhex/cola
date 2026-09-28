import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function activityKey(env = process.env) {
  const value = env.ACTIVITY_TOKEN_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("Activity encryption key is not configured");
  return Buffer.from(value, "hex");
}
// Bind ciphertext to the provider and connection; swapping database cells fails.
export function sealActivityToken(token, context, env = process.env) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", activityKey(env), iv);
  cipher.setAAD(Buffer.from(context));
  const bytes = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    bytes.toString("base64url"),
  ].join(".");
}
export function openActivityToken(value, context, env = process.env) {
  const [version, iv, tag, bytes] = value.split(".");
  if (version !== "v1" || !iv || !tag || !bytes)
    throw new Error("Invalid activity credentials");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    activityKey(env),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    cipher.update(Buffer.from(bytes, "base64url")),
    cipher.final(),
  ]).toString("utf8");
}
