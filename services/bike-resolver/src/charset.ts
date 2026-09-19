import { ResolverError } from "./domain.js";
export function decodeDocument(bytes: Buffer, contentType: string) {
  const prefix = bytes.subarray(0, 8192).toString("latin1");
  const meta = prefix.match(/<meta\b[^>]*charset\s*=\s*["']?\s*([\w-]+)/i)?.[1];
  const charset = (
    contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ||
    meta ||
    "utf-8"
  ).toLowerCase();
  const allowed = [
    "utf-8",
    "utf8",
    "windows-1251",
    "cp1251",
    "windows-1252",
    "cp1252",
    "iso-8859-1",
    "latin1",
    "us-ascii",
  ];
  if (!allowed.includes(charset))
    throw new ResolverError(
      "parse_error",
      "Unsupported document charset",
      false,
      "unsupported_charset",
    );
  try {
    return {
      body: new TextDecoder(
        charset === "cp1251"
          ? "windows-1251"
          : charset === "cp1252"
            ? "windows-1252"
            : charset,
      ).decode(bytes),
      charset,
    };
  } catch {
    throw new ResolverError(
      "parse_error",
      "Unsupported document charset",
      false,
      "unsupported_charset",
    );
  }
}
