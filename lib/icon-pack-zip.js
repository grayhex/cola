import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { iconPackByName } from "./icon-pack.js";

const inflate = promisify(inflateRaw);
export const ICON_ZIP_LIMIT = 10 * 1024 * 1024;
export const ICON_FILE_LIMIT = 2 * 1024 * 1024;
const ENTRY_LIMIT = 1024;
const EXPANDED_LIMIT = 32 * 1024 * 1024;
export class IconPackError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "IconPackError";
    this.status = status;
  }
}
const invalid = (message) => { throw new IconPackError(message); };
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Deliberately small ZIP subset: single-disk STORE/DEFLATE, no encryption or
// ZIP64. Entries are read in memory, never extracted under their supplied paths.
export function readIconZipDirectory(input) {
  const bytes = Buffer.from(input);
  if (bytes.length > ICON_ZIP_LIMIT) throw new IconPackError("ZIP должен быть не больше 10 МБ", 413);
  if (bytes.length < 22) invalid("Повреждённый ZIP-архив");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      end = i;
      break;
    }
  }
  if (end < 0) invalid("Не найден каталог ZIP-архива");
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12), offset = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count)
    invalid("Многотомные ZIP-архивы не поддерживаются");
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff)
    invalid("ZIP64 не поддерживается");
  if (!count || count > ENTRY_LIMIT) invalid("Допустимо от 1 до 1024 записей в ZIP");
  if (offset + size !== end) invalid("Повреждённый каталог ZIP");
  const within = (start, length, limit) => {
    if (start < 0 || length < 0 || start + length > limit) invalid("Обрезанный ZIP-архив");
  };
  const entries = [], names = new Set(), regions = [];
  let cursor = offset, expanded = 0;
  for (let i = 0; i < count; i++) {
    within(cursor, 46, end);
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) invalid("Повреждённая запись каталога ZIP");
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16), compressed = bytes.readUInt32LE(cursor + 20);
    const uncompressed = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const disk = bytes.readUInt16LE(cursor + 34), attributes = bytes.readUInt32LE(cursor + 38);
    const local = bytes.readUInt32LE(cursor + 42);
    if (flags & 0x2041) invalid("Зашифрованные ZIP-архивы не поддерживаются");
    if (![0, 8].includes(method)) invalid("Используйте ZIP со сжатием Deflate или без сжатия");
    if (disk || [compressed, uncompressed, local].includes(0xffffffff)) invalid("ZIP64 и многотомные архивы не поддерживаются");
    if (!nameLength || nameLength > 512) invalid("Недопустимая длина имени файла");
    within(cursor + 46, nameLength + extraLength + commentLength, end);
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const filename = rawName.toString("utf8");
    const parts = filename.split("/");
    if (/^[\/\\]|[\\:\x00-\x1f\x7f\ufffd]/.test(filename) || parts.some((part, n) => part === ".." || part === "." || (!part && n !== parts.length - 1)))
      invalid("Небезопасный путь в ZIP: " + filename.slice(0, 80));
    const type = (attributes >>> 16) & 0xf000;
    if (type && ![0x8000, 0x4000].includes(type)) invalid("Ссылки и специальные файлы в ZIP запрещены");
    if (names.has(filename.toLowerCase())) invalid("Повторяющийся путь в ZIP: " + filename);
    names.add(filename.toLowerCase());
    expanded += uncompressed;
    if (expanded > EXPANDED_LIMIT) invalid("Распакованный архив превышает 32 МБ");
    // Validate local headers too, including paths and overlapping payloads.
    within(local, 30, offset);
    if (bytes.readUInt32LE(local) !== 0x04034b50) invalid("Повреждённый заголовок файла ZIP");
    if (bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method)
      invalid("Несогласованные заголовки ZIP");
    const localNameLength = bytes.readUInt16LE(local + 26), localExtraLength = bytes.readUInt16LE(local + 28);
    within(local + 30, localNameLength + localExtraLength, offset);
    if (!bytes.subarray(local + 30, local + 30 + localNameLength).equals(rawName))
      invalid("Имя файла не совпадает с каталогом ZIP");
    const dataStart = local + 30 + localNameLength + localExtraLength;
    within(dataStart, compressed, offset);
    if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== uncompressed))
      invalid("Размер или контрольная сумма в заголовках ZIP не совпадают");
    regions.push([local, dataStart + compressed]);
    entries.push({ filename, method, crc, compressed, uncompressed, dataStart, directory: filename.endsWith("/") });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) invalid("Неверная длина каталога ZIP");
  regions.sort((a, b) => a[0] - b[0]);
  if (regions.some((region, i) => i && region[0] < regions[i - 1][1])) invalid("Пересекающиеся файлы в ZIP");
  return { bytes, entries };
}

export async function readIconPack(input) {
  const { bytes, entries } = readIconZipDirectory(input);
  const selected = new Map();
  const ignored = [];
  for (const entry of entries) {
    if (entry.directory) continue;
    const parts = entry.filename.split("/"), filename = parts.at(-1);
    if (parts.some((part) => part.startsWith(".") || part === "__MACOSX" || /^png-\d+$/i.test(part) || ["previews", "source"].includes(part))) {
      ignored.push(entry.filename);
      continue;
    }
    const match = /^([a-z][a-z0-9_]*)\.(png|webp)$/i.exec(filename);
    const key = match?.[1].toLowerCase();
    if (!key || !Object.hasOwn(iconPackByName, key)) {
      ignored.push(entry.filename);
      continue;
    }
    const priority = parts.at(-2)?.toLowerCase() === "png" ? 2 : 1;
    const before = selected.get(key);
    if (before?.priority === priority) invalid("Несколько мастер-файлов для слота " + key);
    if (before && before.priority > priority) { ignored.push(entry.filename); continue; }
    if (before) ignored.push(before.filename);
    selected.set(key, { ...entry, key, priority });
  }
  if (!selected.size) invalid("В архиве нет известных PNG/WebP-иконок. Загрузите исходный ZIP с папкой png/; SVG, превью и версии png-24/32/40/256 пропускаются.");
  const icons = [];
  for (const entry of selected.values()) {
    if (!entry.uncompressed || entry.uncompressed > ICON_FILE_LIMIT) invalid("Файл " + entry.filename + " должен быть не больше 2 МБ");
    const compressed = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressed);
    let data;
    try {
      data = entry.method === 0 ? compressed : await inflate(compressed, { maxOutputLength: entry.uncompressed });
    } catch { invalid("Не удалось распаковать " + entry.filename); }
    if (data.length !== entry.uncompressed || crc32(data) !== entry.crc) invalid("Повреждён файл " + entry.filename + " (CRC/размер)");
    icons.push({ key: entry.key, filename: entry.filename, bytes: data });
  }
  return { icons, ignored };
}
