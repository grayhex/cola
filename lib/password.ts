import {
  scrypt as scryptCb,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
const scrypt = (password: string, salt: string, size: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, size, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
export const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  const actual = await scrypt(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    expectedBuffer.length === actual.length &&
    timingSafeEqual(actual, expectedBuffer)
  );
}
