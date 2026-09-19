// Manual live diagnostic. Not part of CI; never prints a downloaded document.
import pino from "pino";
import { ManufacturerHttpClient } from "../src/http.js";
import { parseDocument, jsonObjects } from "../src/extract.js";
import { withResolution } from "../src/context.js";
import { load } from "cheerio";
const urls = process.argv.slice(2);
if (!urls.length) throw new Error("Supply one or more public product URLs");
let statuses: number[] = [];
const logger = pino(
  { level: "info" },
  {
    write(line) {
      const entry = JSON.parse(line);
      if (entry.statusCode) statuses.push(entry.statusCode);
    },
  },
);
const client = new ManufacturerHttpClient(logger, 700, 15000);
for (const url of urls) {
  statuses = [];
  const start = Date.now(),
    events: any[] = [];
  try {
    await withResolution(
      AbortSignal.timeout(60000),
      (e) => events.push(e),
      async () => {
        const doc = await client.get(url, { blockedDomains: [] }),
          $ = load(doc.body),
          objects = jsonObjects($);
        let result;
        try {
          const parsed = parseDocument(doc);
          result = {
            status: "resolved",
            quality: parsed.quality,
            warnings: parsed.warnings,
            sourceYear: parsed.year,
          };
        } catch (e: any) {
          result = { status: e.status, reason: e.reason };
        }
        console.log(
          JSON.stringify({
            requestedUrl: url,
            finalUrl: doc.url,
            httpStatuses: statuses,
            contentType: doc.contentType,
            charset: doc.charset,
            bytes: doc.byteLength,
            jsonLdScripts: $('script[type="application/ld+json"]').length,
            embeddedObjects: objects.length,
            specSection: events.some((e) => e.event === "spec_section_found"),
            ...result,
            durationMs: Date.now() - start,
          }),
        );
      },
    );
  } catch (e: any) {
    console.log(
      JSON.stringify({
        requestedUrl: url,
        httpStatuses: statuses,
        status: e.status || "upstream_unavailable",
        reason: e.reason || "timeout",
        durationMs: Date.now() - start,
      }),
    );
  }
}
