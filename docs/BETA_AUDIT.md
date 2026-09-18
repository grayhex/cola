# Beta audit and review

Audited main `4678ef7dee170be3222dd602136a5c1e0047ac5e` before edits. Existing
Next.js/JavaScript, PostgreSQL 17, SQL migrations and TypeScript resolver architecture
are retained. This change adds no user-facing feature or redesign.

| Boundary | Finding / disposition |
| --- | --- |
| Cookies/sessions | Existing random 256-bit tokens, SHA-256 stored digest, HttpOnly/SameSite, new token on login, logout deletion, blocked-user filtering retained; production validates Secure. |
| CSRF/permissions | Existing Origin check and owner/admin checks retained and exercised in HTTP suite. Registration cannot self-grant admin. Private photos require owner/public bike. |
| Password timing | Existing scrypt and dummy verification for unknown accounts retained. Email verification/recovery deferred; registration toggle retained. |
| Public serialization | Replaced subtractive serialization with explicit bike/component/photo/social allowlists; factory/raw/service/future columns never copied. Prices remain opt-in. |
| Upload/import | Existing byte/dimension limits and WebP re-encode retained. Central owner quotas inside transactions, same path for import/manual uploads, actual output bytes recorded. Files opened exclusively; rollback cleanup; uncertain COMMIT preserves potentially committed file. |
| Concurrency | All creations lock owner first, then bike. Quota queries run after lock acquisition. Deletes free recorded quota. Concurrent cross-bike uploads/creation run against PostgreSQL 17 in CI, not the single-connection PGlite multiplexer. |
| Filesystem | UUID-generated upload names, existing controlled reads retained. Backfill validates paths and regular files, no filesystem effects in SQL migration. Crash orphan audit supplied. |
| SSRF/external URLs | Existing resolver DNS/IP/redirect protections and unsafe-scheme rejection retained, including manual shop URLs. No browser bypass, no new runtime sources. Existing URL validation prohibits script schemes. |
| Resolver admin | Production internal settings/cache endpoints require shared bearer token. Resolver remains unexposed; main app authorization still checks admin. Local no-token mode is internal development only. |
| Auth abuse | Per-account and verified-proxy IP gates precede larger distributed global ceiling; spoofed forwarded headers ignored. nginx adds independent per-IP protection. |
| SQL/performance | Parameterized queries retained. Showcase bulk-loads components/photos; six queries for 24 bikes, including two site queries. Count/search/category pagination, likes and scores retained. Supporting public/category/time and rate-expiry indexes added. |
| Production config | Separate standalone file, required env and startup validation, localhost-only app port, no DB/resolver host ports. Default local Compose remains usable. |
| Logging/headers | Error class/code + generated correlation ID; no exception message/SQL in server error logging. Modest CSP limits framing/base/object without blocking Next scripts/photos. HTTPS-only HSTS at proxy. |
| Backups | Stops both writers; complete DB + photo volume + checksummed manifest, atomic publication, retention only valid own-format backups. Shared deploy lock. Empty-target-only restore, explicit flag, corruption/path checks, separate-project drill. |
| CI/deploy | `needs: check`, same tested SHA supplied to root-owned script, newer-main skip, existing deployment concurrency. Protocol check prevents old pull-latest script silently deploying unchecked source. |

## Remaining operational limits

- WebKit emulation covers mobile tap and scroll-cancel semantics; physical iOS
  keyboard/viewport should still be smoke-tested on the user's device.
- Filesystem and DB cannot commit atomically. A process crash or ambiguous COMMIT
  can leave orphan files; audit and backup mitigate this without deleting live data.
- Backup briefly interrupts writes and assumes these two services are the only
  writers. Off-host storage, scheduled backups/alerts, TLS/DNS, runner installation
  and branch protection are operator actions, not changes applied to live servers.
- User quotas do not cap total disk use across infinitely many registered users.
  Monitor disk and control beta registration. Admin site assets remain outside user
  quota but retain their existing upload validation and admin access boundary.
- No full script-src CSP, email verification, password recovery, OAuth, external
  storage, SaaS monitoring or automatic destructive cleanup added.
- Large `%search%` scans may eventually need trigram indexes; no speculative search
  service is introduced for beta.

## Reproducible checks

`pnpm install --frozen-lockfile`, `pnpm test`, `pnpm build`; resolver `npm ci`,
`npm test`, `npm run build`; `pnpm test:integration`; `pnpm test:e2e` (install
Chromium/WebKit first); `python3 scripts/test-compose.py`; backup drill in operations
runbook. CI supplies an isolated PostgreSQL 17 service through `TEST_DATABASE_URL`.
The harness creates and removes its own random database; the supplied connection
needs CREATEDB permission. Use a test PostgreSQL server. Without it, local HTTP
smoke uses disposable PGlite with one connection;
the concurrent quota test explicitly requires real PostgreSQL and runs in CI.
