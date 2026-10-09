import { existsSync, readFileSync } from "node:fs";
import pino from "pino";
import {
  ManufacturerHttpClient,
  validateUrl,
  type UrlPolicy,
} from "../../src/http.js";
import { ResolverError, type SourceDocument } from "../../src/domain.js";
const root = new URL("./russian-sources/", import.meta.url);
export interface Page {
  id: string;
  store?: string;
  adapter?: string;
  kind: string;
  url: string;
  requestedUrl: string;
  retrievedAt: string;
  rawSha256: string;
  reducedSha256: string;
  reduction: object;
  origin: { source: string };
}
export const pages: Page[] = JSON.parse(
  readFileSync(new URL("pages.json", root), "utf8"),
);
export const page = (id: string) => {
  const found = pages.find((entry) => entry.id === id);
  if (!found) throw new Error("Missing fixture: " + id);
  return found;
};
export function document(entry: Page): SourceDocument {
  const extension = ["html", "xml", "json", "txt"].find((ext) =>
    existsSync(new URL(entry.id + "." + ext, root)),
  );
  return {
    url: entry.url,
    body: readFileSync(new URL(entry.id + "." + extension, root), "utf8"),
    fetchedAt: entry.retrievedAt,
    hash: entry.rawSha256,
  };
}
export const key = (input: string) => {
  const url = new URL(input);
  url.protocol = "https:";
  url.hostname = url.hostname.replace(/^www\./, "");
  url.hash = "";
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.href;
};
export class RecordedHttp extends ManufacturerHttpClient {
  requested: string[] = [];
  missing: string[] = [];
  constructor() {
    super(pino({ level: "silent" }));
  }
  async get(input: string, policy: UrlPolicy): Promise<SourceDocument> {
    validateUrl(input, policy);
    this.requested.push(input);
    if (
      /^(?:www\.bing\.com|bikepedia\.azurewebsites\.net)$/.test(
        new URL(input).hostname,
      )
    )
      throw new ResolverError(
        "upstream_unavailable",
        "External search is disabled in this fixture test",
        false,
        "blocked_source",
      );
    const found = pages.find((entry) => key(entry.url) === key(input));
    if (!found) {
      this.missing.push(input);
      throw new ResolverError(
        "upstream_unavailable",
        "Page not recorded: " + input,
        false,
        "http_404",
      );
    }
    return document(found);
  }
}
