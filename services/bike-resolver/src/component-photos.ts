import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import pino from "pino";
import { z } from "zod";
import { ManufacturerHttpClient, validateUrl } from "./http.js";
import { SettingsStore } from "./settings.js";

export const componentPhotoQuery = z
  .object({
    category: z.string().trim().min(1).max(60),
    brand: z.string().trim().max(100),
    name: z.string().trim().min(1).max(150),
  })
  .strict();
const hosts = [
  "commons.wikimedia.org",
  "upload.wikimedia.org",
  "thumb.wikimedia.org",
];
const imageHosts = hosts.slice(1);
const ttl = 15 * 60 * 1000;
const text = (html: unknown, max = 1000) => {
  if (typeof html !== "string") return "";
  if (html.length > 10000) throw new Error("Metadata too large");
  const $ = load(html);
  $("style,script").remove();
  const value = $.text().replace(/\s+/g, " ").trim();
  if (value.length > max) throw new Error("Metadata too large");
  return value;
};
const phrase = (value: string) =>
  '"' +
  value
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim() +
  '"';
const categories: Record<string, string> = {
  рама: "bicycle frame",
  амортизатор: "shock",
  групсет: "groupset",
  "манетки / дуалы": "shifter",
  "система / шатуны": "crankset",
  каретка: "bottom bracket",
  роторы: "brake rotor",
  втулки: "bicycle hub",
  "камеры / бескамерка": "bicycle tire",
  рулевая: "headset",
  "подседельный штырь": "seatpost",
  "грипсы / обмотка": "handlebar",
  велокомпьютер: "bicycle computer",
  датчики: "bicycle sensor",
  "передний свет": "bicycle light",
  "задний свет": "bicycle light",
  "подседельная сумка": "saddle bag",
  "рамная сумка": "frame bag",
  "сумка на руль": "handlebar bag",
  багажник: "bicycle rack",
  крылья: "bicycle fender",
  "фляга / держатель": "bottle cage",
  насос: "bicycle pump",
  инструменты: "bicycle tool",
  замок: "bicycle lock",
  звонок: "bicycle bell",
  другое: "bicycle",
  седло: "saddle",
  покрышки: "tire",
  покрышка: "tire",
  тормоза: "brake",
  руль: "handlebar",
  педали: "pedal",
  вилка: "fork",
  кассета: "cassette",
  цепь: "chain",
  система: "crankset",
  вынос: "stem",
  колеса: "wheel",
  колёса: "wheel",
  "задний переключатель": "derailleur",
  "передний переключатель": "derailleur",
  "передняя втулка": "hub",
  "задняя втулка": "hub",
  подседельный: "seatpost",
};
export function commonsQuery(input: z.infer<typeof componentPhotoQuery>) {
  const category = categories[input.category.toLowerCase()] || input.category;
  return [
    phrase(category),
    ...(input.brand ? [phrase(input.brand)] : []),
    phrase(input.name),
    "filetype:bitmap",
  ].join(" ");
}
export function commonsUrl(input: string, allowed = hosts) {
  const u = validateUrl(input, allowed);
  if (u.protocol !== "https:") throw new Error("HTTPS required");
  return u.href;
}
type Credit = {
  provider: string;
  url: string;
  imageUrl: string;
  title: string;
  creator: string;
  credit: string;
  license: string;
  licenseUrl: string;
};
export function commonsResults(data: any): Credit[] {
  if (data?.error || !data || typeof data !== "object")
    throw new Error("Commons unavailable");
  const pages: any[] = Object.values(data.query?.pages || {});
  pages.sort((a, b) => (a?.index ?? 100) - (b?.index ?? 100));
  const found: Credit[] = [];
  for (const page of pages.slice(0, 12)) {
    const image = page?.imageinfo?.[0],
      meta = image?.extmetadata;
    if (
      !image ||
      !meta ||
      !["image/jpeg", "image/png", "image/webp"].includes(image.mime) ||
      ![image.size, image.width, image.height].every(
        (v) => Number.isSafeInteger(v) && v > 0,
      ) ||
      image.size > 8 * 1024 * 1024 ||
      image.width * image.height > 40000000 ||
      Math.min(image.width, image.height) < 400 ||
      Math.max(image.width, image.height) < 600
    )
      continue;
    try {
      const license = new URL(meta.LicenseUrl?.value);
      const licensePath = license.pathname.replace(/\/deed\.[a-z-]+$/i, "");
      // Only licenses whose attribution can be represented completely here.
      if (
        license.hostname !== "creativecommons.org" ||
        license.username ||
        license.password ||
        license.port ||
        !["http:", "https:"].includes(license.protocol) ||
        !/^\/(?:licenses\/(?:by|by-sa)\/(?:2\.0|2\.5|3\.0|4\.0)|publicdomain\/zero\/1\.0)\/?$/.test(
          licensePath,
        )
      )
        continue;
      const creator = text(meta.Artist?.value, 500);
      if (!creator || !text(meta.LicenseShortName?.value)) continue;
      const source = {
        provider: "Wikimedia Commons",
        url: commonsUrl(image.descriptionurl, [hosts[0]]),
        imageUrl: commonsUrl(image.url, imageHosts),
        title: text(page.title, 300).replace(/^File:/, ""),
        creator,
        credit: text(meta.Attribution?.value || meta.Credit?.value),
        license: text(meta.LicenseShortName.value, 80),
        licenseUrl: "https://creativecommons.org" + licensePath,
      };
      if (source.url.length > 2048 || source.imageUrl.length > 2048) continue;
      if (!found.some((p) => p.imageUrl === source.imageUrl))
        found.push(source);
    } catch {
      /* Omit unsafe URLs and incomplete licensing metadata. */
    }
  }
  return found.slice(0, 6);
}

export class ComponentPhotoSearch {
  private photos = new Map<string, { source: Credit; expires: number }>();
  private cache = new Map<string, { sources: Credit[]; expires: number }>();
  private backoffUntil = 0;
  private http: ManufacturerHttpClient;
  constructor(
    private settings: SettingsStore,
    http?: ManufacturerHttpClient,
  ) {
    this.http =
      http ??
      new ManufacturerHttpClient(
        pino(),
        1000,
        10000,
        () => this.settings.value,
        {
          attempts: 1,
          httpsOnly: true,
          userAgent:
            "ColaBike/1.0 (https://colabike.ru; support@colabike.ru) component-photo-search",
          onBackoff: (ms) => {
            this.backoffUntil = Date.now() + ms;
          },
        },
      );
  }
  private enabled() {
    if (
      !this.settings.value.enabled ||
      !this.settings.value.photoSearch ||
      Date.now() < this.backoffUntil
    )
      throw new Error("Photo search unavailable");
  }
  async search(input: z.infer<typeof componentPhotoQuery>) {
    this.enabled();
    const query = commonsQuery(input);
    const cached = this.cache.get(query);
    let sources =
      cached && cached.expires > Date.now() ? cached.sources : undefined;
    if (!sources) {
      const url = new URL("https://commons.wikimedia.org/w/api.php");
      url.search = new URLSearchParams({
        action: "query",
        format: "json",
        generator: "search",
        gsrsearch: query,
        gsrnamespace: "6",
        gsrlimit: "12",
        prop: "imageinfo",
        iiprop: "url|extmetadata|size|mime",
        iiextmetadatafilter:
          "Artist|Credit|Attribution|LicenseShortName|LicenseUrl",
        maxlag: "5",
      }).toString();
      const doc = await this.http.get(url.href, [hosts[0]]);
      sources = commonsResults(JSON.parse(doc.body));
      if (this.cache.size >= 40)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(query, { sources, expires: Date.now() + ttl });
    }
    for (const [id, photo] of this.photos)
      if (photo.expires <= Date.now()) this.photos.delete(id);
    return {
      provider: "Wikimedia Commons",
      query,
      photos: sources.map((source) => {
        if (this.photos.size >= 500)
          this.photos.delete(this.photos.keys().next().value!);
        const id = randomUUID();
        this.photos.set(id, { source, expires: Date.now() + ttl });
        return { id, source };
      }),
    };
  }
  async photo(id: string) {
    this.enabled();
    const p = this.photos.get(id);
    if (!p || p.expires <= Date.now()) throw new Error("Search expired");
    const image = await this.http.getBytes(
      commonsUrl(p.source.imageUrl, imageHosts),
      imageHosts,
    );
    if (!/^image\/(jpeg|png|webp)(?:;|$)/i.test(image.contentType))
      throw new Error("Unsupported image");
    return { data: image.bytes.toString("base64"), source: p.source };
  }
}
