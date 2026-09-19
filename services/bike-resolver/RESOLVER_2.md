# Bike Resolver 2.0

## Architecture decision

The v1 discovery adapters and pinned HTTP transport remain. Extraction now runs several bounded strategies over one Cheerio document; each produces `{label,value,section?,strategy,confidence}`. A common collector validates labels, deduplicates canonical component types and retains conflicting evidence for review. This replaces reliance on a successful brand selector. Specialized no longer uses a generated CSS class.

The source planner orders manufacturer, archive, explicit URL, retailer and generic providers and caps a request at three providers. Existing adapters own official discovery, including archives. `POST /v1/resolve` accepts an optional fallback `sourceUrl`: official resolution first, then the supplied page if necessary. Explicit URL actions (`/v1/resolve-url` and the wizard stream with `sourceUrl`) go directly to the user's page. Providers implement a small `resolve` contract; their discovery can return the existing `BikeCandidate[]` model. Add a provider to the plan without modifying extraction. No global retailer search index is shipped. Results from different models/sources are never merged; ambiguous official matches require confirmation or an explicitly supplied page.

## Extraction and quality

- JSON-LD Product, ProductGroup, Bicycle and additionalProperty.
- Inert Next/application JSON and RSC `self.__next_f` chunks, parsed with JSON.parse only.
- Two-cell table rows, including nested tables. Prefer the table with the most recognized component labels to avoid comparison/related-product tables.
- Definition lists, repeated label/value blocks, semantic specification sections (English/Russian/German), heading/value and heading/bullet lists.
- Generic Shopify description fragments and tiny semantic site profiles in `profiles.ts`; no product-URL-specific selectors.

Metadata, marketing, shipping, warranty, reviews and geometry are not components. New aliases cover Russian separate brakes, plural cranksets/cassettes, handle lever, hubs, spokes and inner tubes. Front/rear types retain their position. Unknown labels inside a specification section remain in `rawSpecification` and `unknownFields`; conflicting alternatives remain in `unknownFields` with `conflicting_sources`, rather than being concatenated into a fictional component.

Compatibility: outer status stays `resolved`. `quality.level` is `complete` or `partial`. Central thresholds in `extract.ts`: at least three recognized components for a useful result; at least eight and coverage ≥65% for complete. Below three is parse_error. These describe extraction usefulness, not confidence in model identity. Count excludes bike-level metadata and includes unknown specification labels; conflicting duplicate alternatives are reported separately. Every extracted component has source URL, strategy, confidence and exact raw label/value provenance. Raw strings are retained after whitespace cleanup.

Suggested weight, sizes, wheel size, color and product ID are separate metadata. Multiple size-dependent weights remain text; no arbitrary weight is chosen. The wizard only applies an unambiguous weight/color to empty fields after an explicit click. Prices are never imported as the owner's purchase price. A missing source year remains null and requires candidate confirmation; the requested year remains user input, not source evidence.

## Trace and API

`POST /v1/resolve/stream` accepts the same identity plus optional candidateId/sourceUrl. Response is `application/x-ndjson`:

```json
{"type":"event","event":"components_recognized","elapsedMs":1240,"count":22,"total":24}
{"type":"result","result":{"status":"resolved","query":{},"cached":false}}
```

The abbreviated result above has the ordinary resolve response shape. Event names are centralized in `context.ts`. Payloads only contain an event name, elapsed time, public hostname, strategy, counts and enumerated reason. No URLs with parameters, HTML, stack traces, headers or private IPs are streamed. Maximum 240 events. A cache hit emits cache_checked/cache_hit and completion without fake discovery or network events.

ColaBike proxies through `POST /api/bikes/resolve-stream`, behind the existing authenticated/origin-checked route and shared 30-request resolver rate limit. The proxy validates NDJSON, whitelists event fields, caps the response at 4 MiB and creates the same owner-bound expiring preview as the JSON endpoint. Cancellation travels from browser through Next/Fastify to queued requests, DNS waiting and fetch. Existing non-streaming clients remain compatible.

Wizard step 2 shows a compact live timeline and expandable details; there is no percentage estimate. Failed source/fallback events do not discard a later success. Partial results are editable on step 3 with unknown-field review. Screen readers receive only the current status, not a live announcement for every row; reduced-motion rules cover the spinner.

Admin inspector uses `POST /api/admin/resolver/inspect`, the same trace and rate limit, but does not create user previews. It shows raw/normalized/unknown fields, warnings, source and timings. `GET /api/admin/resolver/diagnostics` proxies token-protected `/internal/diagnostics`. Per-provider last success/failure/reason are bounded process-local diagnostics, cleared on restart, not durable telemetry. Existing adapter versions appear alongside extractor version 2.

## Transport, cache and safety

Charset precedence is HTTP Content-Type → first 8 KiB HTML meta → UTF-8. Supported legacy encodings include Windows-1251/1252 and ISO-8859-1; unsupported encodings have an explicit reason. Content is never executed. Document cap remains 8 MiB, JSON traversal is bounded, raw candidates capped at 600. One request-scoped document map avoids downloading tracking-equivalent URLs twice. Only known tracking parameters and fragments are stripped; product/variant query parameters are preserved. A page's arbitrary canonical link is not trusted as another product identity.

Result cache keys include generic extractor/schema version 2 as well as adapter version. Existing entries expire naturally; deployment does not clear all caches. Manual URL results continue to be uncached, because explicit inspection should read the supplied page. The existing DNS/IP checks, per-redirect validation, pinning, host queue, GET retries, document limit and admin blocklist remain. The blocklist is checked for official requests as well. Stop never weakens these checks. No new DB migration, infrastructure, external search dependency, LLM or headless browser is required.

Sanitized reasons include dns_failed, timeout, http_403/404/429, access_challenge, unsupported_charset, body_too_large, js_shell, spec_fields_not_found, labels_unrecognized, identity_mismatch and conflicting_sources. A failure is not negatively cached as not_found.

## Regression corpus and extension

`tests/fixtures/layouts/` contains small real Specialized, Trial-Sport and Shopify excerpts captured on 2026-09-19. Tests also define minimal synthetic JSON-LD, Next, table/nested-table, dl, repeated-card, partial, unknown/conflict, marketing and Windows-1251 examples; existing HTTP tests cover access challenges and private DNS/redirects. No fixture test calls a manufacturer.

To add a strategy, produce bounded RawField candidates through the collector and add layout-focused positive/false-positive tests. Do not normalize inside a strategy. To add a SiteProfile, use semantic section hints and a framework detector; add a test with changed CSS classes. Bump EXTRACTOR_VERSION/RESULT_SCHEMA_VERSION when semantics change, adapterVersion for adapter-specific parsing changes.

Manual diagnosis from the service directory:

```sh
node --import tsx scripts/diagnose.ts 'https://manufacturer.example/product'
```

It uses the production safe transport and prints HTTP statuses, charset, final URL, byte count, layout evidence, quality and duration, never the HTML. If it reports dns_failed, establish network/DNS availability before diagnosing extraction. Do not bypass challenges. See `ACCEPTANCE_2.md` for observed results and the distinction between HTTP acquisition and end-to-end transport.

Known limitations: no general internet discovery for unknown brands; supply a product URL. No rendered fallback: all three acceptance pages contain static specification data. Truly JS-only or challenge pages remain explicit failures. Very unusual prose/spec layouts and multiple conflicting variants need user review. Diagnostic history is process-local. Source metadata remains a suggestion, not a verified owner attribute.
