# Bike Resolver

Optional deterministic factory-spec enrichment service for ColaBike. Node 22+, TypeScript, Fastify, Zod, Cheerio, PostgreSQL. No LLM or browser dependency.

## Architecture and integration

Browser → authenticated ColaBike API → single `lib/bike-resolver-client.js` transport → internal resolver → manufacturer adapter → normalized specification + original raw values. Resolver owns `bike_resolver` schema and migrations on the existing PostgreSQL server. It never reads app tables. The app owns `bikes.factory_spec` and current components separately.

New bike: enter `Giant Contend AR 1 2024` in its name and leave the field, or fill brand/model/trim/year separately. After 1.4 seconds without changes, an enabled adapter runs automatically. The animated indeterminate progress bar reports ongoing parsing, with elapsed time and a manual continuation option. Only a resolved identity is queued for import. Saving persists the bike first, then imports its specification through the server. Failure leaves a usable manually editable bike and a warning.

Existing bike: editing does not automatically import factory parts. Use Find and Import explicitly. Import may seed an **empty** current configuration; any existing components are preserved. Repeated imports are idempotent and locked against concurrent component insertion. Changed bike identity invalidates the saved factory spec. Raw data and source provenance remain in `factory_spec` even when display names are shortened to existing component field limits.

## API

- `POST /v1/resolve`: `{brand, model, trim: string|null, year: number}`; optional opaque `candidateId` from an ambiguous response (not a URL).
- `GET /v1/brands`: enabled state, adapter version, documented limitation and `autoResolve`.
- `GET /health`, `GET /ready`: liveness and cache database readiness.
- Internal management: `GET/PUT /internal/settings`, `DELETE /internal/cache?adapter=giant` (omit adapter for all).
- App gateway: `POST /api/bikes/resolve`, `GET /api/bikes/resolver-brands`, `POST /api/bikes/:id/factory-spec` with `{candidateId?,initializeCurrent?:boolean}`. The latter always resolves server-side, never trusts uploaded specifications.
- Admin gateway: `GET/PUT /api/admin/resolver`, `DELETE /api/admin/resolver/cache?adapter=...`. Existing admin authentication, origin checks and audit log apply.

Results distinguish `resolved`, `ambiguous`, `not_found`, `unsupported_brand`, `upstream_unavailable`, `parse_error`. A disabled adapter returns `unsupported_brand`. Automatic matching requires confirmed year and trim, score ≥ 0.95 and margin ≥ 0.06. Explicit selection also requires confirmed year and matching model (minimum 0.88). Unknown years never auto-match.

## Brand status

| Adapter | Default | Evidence / limitation |
| --- | --- | --- |
| Specialized | enabled | Real Diverge Comp Carbon 2023 reduced HTML fixture; official sitemap discovery |
| Canyon | enabled | Real Grail CF SLX 8 AXS 2026 reduced HTML fixture; official locale sitemap discovery |
| Giant | enabled | Contend AR 1 2024; deterministic official URL discovery, parser/API/cache integration tested |
| CUBE | disabled | Old archive redirects to portal without accessible catalogue/specification |
| Trek | disabled | Captured page has no parseable specification |
| Scott | disabled | Captured page has no parseable specification |
| Orbea | disabled | Site access challenge; no bypass |
| Cannondale | disabled | Topstone 1 specs parse, but model year unconfirmed |
| Merida | disabled | Silex 400 specs parse, but model year unconfirmed |
| BMC | disabled | Specs parse, but model year unconfirmed |

**CUBE Travel SL 2020 live acceptance is not fulfilled.** The archive-data normalization regression fixture is not evidence of live discovery. Unreliable manufacturers are skipped per the updated scope. Admin may enable them for diagnostics. Fixtures document original URLs and capture metadata. Live availability can differ by date, region and IP; offline fixture tests are not live availability guarantees. Catalogue discovery is bounded and reports unavailable rather than caching a false absence when it cannot finish.

## Configuration and cache

Docker environment: `DATABASE_URL` required, `PORT=8080`, `LOG_LEVEL=info`. Main app: `BIKE_RESOLVER_URL=http://bike-resolver:8080`. Infrastructure addresses/credentials remain environment settings, never sent to browsers or editable as arbitrary URLs.

Admin → Bike Resolver controls persisted enable/automatic flags, all ten adapters, upstream timeout (3–20 seconds), request interval (0.5–5 seconds), successful cache TTL (30–730 days; default 90), negative TTL (1–48 hours; default 24). Changes apply without restart, with optimistic version checks. TTL changes apply to new cache writes; use clear cache for immediate invalidation of old results. Clear controls remove resolved/negative entries, not the adapter's bounded one-day in-memory discovery documents. For a full source reload restart the resolver as well.

Successful cache keys include normalized brand/model/trim/year and optional selected candidate. Entries store query, response, source URL/hash, timestamps and adapter/version; adapter version changes invalidate old rows. Only success/not_found are cached. Identical concurrent lookups are coalesced. Settings and cache survive container restarts.

HTTP: exact official-domain allowlists, DNS validation against non-public addresses, pinned checked IP, validation of every redirect, 4 redirects, safe GET retries/backoff, timeouts, 8 MiB response limit, per-host serialization and minimum interval. Request/error logs are structured JSON without page bodies. Internal management API trusts the private Docker network; **do not publish resolver ports or route `/internal/*` through a public proxy**. Only the app's authenticated admin gateway should expose management. Scaling resolver to multiple instances requires shared settings refresh; v1 runs one container.

## Local development and tests

```sh
cd services/bike-resolver
npm ci
npm run typecheck
npm test
npm run build
DATABASE_URL=postgresql://... npm start
```

`npm test` is offline: fixtures, taxonomy, strict matching/year/ambiguity, cache/version/expiry, settings persistence, disabled adapters and SSRF/redirect/HTTP transport. Root `npm test` also covers import idempotency, current-component preservation and stale identity rejection. `tests/fixture-server.ts` is a disposable test-only HTTP server returning the captured Giant document through the real parser/core; it is not included in Docker's runtime build.

## Docker and deployment

From repository root:

```sh
docker compose up --build -d
docker compose logs --tail=100 bike-resolver
```

Resolver exposes 8080 only on the Compose network and migrates its own schema at startup. App migration `003_factory_spec.sql` adds trim and JSONB factory specification. App starts independently of resolver health, preserving manual operation. Existing self-hosted deployment invokes an external `/usr/local/sbin/deploy-cola`; ensure its Compose invocation builds/starts **all services**, not only `app`. The script itself is not in this repository.

Local-only CUBE diagnostic (service running locally on 8080; enable CUBE in admin before testing discovery):

```sh
curl -X POST http://localhost:8080/v1/resolve \
  -H 'Content-Type: application/json' \
  -d '{"brand":"CUBE","model":"Travel","trim":"SL","year":2020}'
```

Expected current default is `unsupported_brand`, not a fabricated success. Positive fixture acceptance uses `Giant / Contend / AR 1 / 2024`.

## Adding a manufacturer

1. Research official archives/sitemaps/public structured data; capture a small real fixture and provenance JSON. Do not bypass access challenges.
2. Add one adapter under `src/adapters` implementing `BikeManufacturerAdapter`, or extend `CatalogueAdapter` for shared bounded discovery. Define id/brand/aliases, exact official allowed domains, product URL matcher and seeds/direct URL rules. Prefer JSON-LD/embedded data and semantic rows. Override candidate metadata only with source evidence, never infer a year from the request.
3. Keep discovery, fetching, metadata and spec extraction separate. Use the shared HTTP client. Register the adapter in `src/adapters/index.ts`, add its admin flag/limitation/default in settings and a migration for existing settings records.
4. Add label aliases to the shared normalizer only where necessary. Preserve raw labels/values, expose unknown components as `other`, do not invent part numbers.
5. Cover discovery, confirmed year, neighboring trims, ambiguity, upstream failure and the real spec fixture offline. Enable only after reliable discovery and identity verification; document limitations otherwise.
6. Increment `adapterVersion` after parsing changes to invalidate earlier cached entries. No resolver-core edits should be necessary for another brand.
