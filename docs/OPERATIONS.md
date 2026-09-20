# Beta operations

## Local/staging compatibility

The existing VM stays at `/opt/stacks/cola`. Local `compose.yaml` needs no TLS,
production domain, proxy or new secrets:

```bash
cd /opt/stacks/cola
git pull --ff-only
docker compose up --build -d
docker compose ps
```

Do not run `down -v` on an environment containing user data. PostgreSQL and photos
remain in the existing named volumes. Migration 008 only adds nullable `size_bytes`
and indexes; it does not rewrite existing files, bikes, settings or resolver cache.

## CI and deployment workflows

GitHub Actions is deliberately split into three visible workflows:

| Workflow | Trigger | Target |
| --- | --- | --- |
| **CI · ColaBike** | PR, push to `main`, manual | Hosted GitHub runner; no deployment |
| **Deploy · Staging** | Manual, with branch/tag/SHA input | `192.168.1.200` via `cola-staging` |
| **Deploy · Production** | Automatically after successful CI push to `main`, or manual redeploy from `main` | `colabike.ru` via `cola-production` |

`CI · ColaBike` runs unit/DB tests, builds, HTTP tests on PostgreSQL 17,
Chromium + mobile WebKit, Compose assertions and the disposable backup/restore
drill. PR code runs only on GitHub-hosted runners.

Production deploy receives the exact SHA from the successful `main` CI run. The
self-hosted production job deliberately does not run `actions/checkout` or other
Marketplace actions: it only invokes the root-owned deployment wrapper. That
wrapper fetches `origin/main` using the repository owner's read-only SSH deploy key
and refuses a stale/non-main SHA. If `.env.production` exists it uses
`compose.prod.yaml` with that env file. Optional `[hagsy-demo]` verification runs
inside the deployed app container after a successful rollout.

Staging is intentionally manual. Run **Deploy · Staging** from the workflow's
`main` definition and enter the feature branch, tag or SHA in the `ref` field.
That exact commit is resolved on a hosted runner, passes the same CI, then is
deployed to the internal VM by `/usr/local/sbin/deploy-cola-staging`. The staging
wrapper records the deployed SHA in `/var/lib/colabike/staging-sha`.

### One-time production runner setup

Production runner labels must include `self-hosted` and `cola-production`.
Install the reviewed wrapper root-owned:

```bash
sudo install -o root -g root -m 755 ops/deploy-cola /usr/local/sbin/deploy-cola
```

Grant only:

```text
github-runner ALL=(root) NOPASSWD: /usr/local/sbin/deploy-cola
```

Do **not** add `github-runner` to the Docker group.

### One-time staging runner setup

The runner on `192.168.1.200` must have custom label `cola-staging`. Install:

```bash
sudo install -o root -g root -m 755 ops/deploy-cola-staging /usr/local/sbin/deploy-cola-staging
```

Grant only:

```text
github-runner ALL=(root) NOPASSWD: /usr/local/sbin/deploy-cola-staging
```

The staging repository stays at `/opt/stacks/cola` and is checked out onto a local
`staging-deploy` branch at the verified SHA. The wrapper does **not** trust a
feature branch's `compose.yaml`: it materializes `compose.yaml` from current
`origin/main` into a root-owned temporary file and uses that trusted topology to
build/run the selected source. This prevents a staging ref from changing host
mounts, privileged flags or other root-level Compose controls. It must keep its own
database and volumes; staging data is never promoted automatically.

In GitHub branch protection for `main`, require the **check** job from
**CI · ColaBike**, require the branch to be up to date, disallow force pushes, and
require PR review. Only trusted administrators should modify workflow files or
operate self-hosted runners.

## Limits and existing photo sizes

| Environment variable | Beta default |
| --- | ---: |
| MAX_BIKES_PER_USER | 20 |
| MAX_PHOTOS_PER_USER | 240 |
| MAX_PHOTO_BYTES_PER_USER | 524288000 (500 MiB) |
| BIKE_CREATES_PER_15_MIN | 30 |
| PHOTO_UPLOADS_PER_15_MIN | 60 |

Set optional overrides in `.env` or `.env.production`, then recreate app. Invalid
non-positive limits fail startup. Per-file 10 MiB and per-bike 12 photos remain.
Manual upload and resolver import share a rate bucket, owner lock and quota;
site assets are separate. Storage accounts for the processed WebP, not input size.
Unknown legacy sizes conservatively reserve 10 MiB per file until backfilled:

```bash
docker compose exec -T app node scripts/recalculate-photo-storage.js
docker compose exec -T app node scripts/recalculate-photo-storage.js --apply
```

First command is dry-run. The script locks each owner and photo rows, rejects
missing files/symlinks/invalid paths, updates size metadata only and returns nonzero
on problems. It never deletes photos. Repeat safely after resolving missing files.
Deleting a photo/bike releases its recorded quota. Crash leftovers are possible
because PostgreSQL and filesystem do not share a transaction. Inspect with:

```bash
docker compose exec -T app node scripts/audit-photo-files.js
```

Optional `--prune-orphans` removes only recognized, unreferenced regular image files
older than 24 hours. Take a backup first. Missing referenced files require recovery.
Run audit and disk-space monitoring periodically; quotas do not replace disk alarms
or a global registration policy. Close registration in admin when necessary.

## Backup and restore

Run as an operator with Docker access and permission for
`/var/lock/colabike-deploy.lock` (normally root). Backup/deploy share this lock.
Use the same Compose project name/files/env as the running stack. Defaults use
`compose.yaml`; production must set `COLA_COMPOSE_FILES=compose.prod.yaml` and
`COLA_ENV_FILE=.env.production`. Paths should be absolute when invoked by cron.

```bash
sudo bash scripts/backup-colabike.sh --destination /srv/colabike-backups --keep 7
sudo python3 scripts/backup.py verify --backup /srv/colabike-backups/colabike-TIMESTAMP-ID
```

Backup briefly stops app and resolver, dumps the entire PostgreSQL database
(including resolver schema), archives the photos volume (including site assets),
checks SHA-256/archive paths, and atomically publishes a private directory with
manifest. Previously running services resume even on failure. No partial backup
is eligible for retention. Ensure no external process writes DB/photos during
backup. Schedule a maintenance window; service downtime depends on data size.
Retention removes only validated ColaBike backup directories beyond `--keep`.
Copy successful directories **off-host** to NAS, another server or backup/object
storage; encrypt them and restrict access because they contain personal data.
No cloud provider is required by the scripts.

Restore into an **empty separate project**, never over existing data:

```bash
# In a checkout of the same app version, with target env configured:
export COMPOSE_PROJECT_NAME=cola-restored
sudo -E bash scripts/restore-colabike.sh --backup /absolute/backup-directory --yes
docker compose up -d --wait
curl --fail http://localhost:3000/api/ready
```

Resolve port conflicts before starting the restored app; use a separate machine or
an isolated Compose config. `--yes` is mandatory. All checksums are checked before
touching the destination; nonempty DB/photos are refused. Restore leaves app and
resolver stopped until explicitly started. A restore failure may leave the *new*
target partially restored: preserve the source backup and retry in another empty
project. Never delete an existing production volume to satisfy this requirement.
Check login, known bikes, private/public photos and admin settings after restore.

Repeatable automated drill (Docker required, no production ports/volumes used):

```bash
bash scripts/test-backup-drill.sh
```

It creates two random projects, builds/starts the stack, inserts DB/photo markers,
backs up, restores to the second project, verifies bytes and rows, rejects an
overwrite and corruption, and removes only its disposable projects.

## Migration from staging VM to production VDS

1. Install Docker Engine + Compose plugin, nginx and an ACME client on the VDS.
2. Clone the tested repository into `/opt/stacks/cola`.
3. Copy `.env.production.example` to `.env.production`, `chmod 600` it. Generate
   each secret independently with `openssl rand -hex 32`. Set origin exactly
   `https://colabike.ru`, cookies true. Use URL-safe DB secrets (hex avoids URL
   escaping). Existing PostgreSQL volumes retain their original password; changing
   env alone does not rotate it.
4. Plan persistent disk space for database/photos and off-host backup. Set a stable
   Compose project name. Never merge local and production Compose files: production
   is **standalone**, preventing accidental additive public port mappings.
5. Restore the staging backup into the empty production project with
   `COLA_COMPOSE_FILES=compose.prod.yaml COLA_ENV_FILE=.env.production`, or start clean.
6. Validate and start:

   ```bash
   docker compose --env-file .env.production -f compose.prod.yaml config --quiet
   docker compose --env-file .env.production -f compose.prod.yaml up --build -d --wait
   ```

   Only `127.0.0.1:3000` is published. DB/resolver have no host port. App refuses
   insecure production settings before migrations. Never print rendered Compose
   configuration into public logs because it contains secrets.
7. Prepare `ops/nginx-colabike.conf`; replace the proxy key with the exact env value,
   restrict config access. Initially enable its HTTP ACME location only.
8. Point DNS A/AAAA at the VDS; only publish AAAA if IPv6 routing works. Firewall
   exposes 80/443 and your restricted SSH access, not DB/resolver/3000.
9. Obtain a certificate with the chosen ACME client, enable the full nginx template,
   run `nginx -t`, reload and enable certificate renewal. TLS/HSTS belong only here.
10. Check `/api/health`, `/api/ready`, `/api/status` over HTTPS, redirects and cookies.
11. Verify/promote the admin using the existing README admin instructions; keep
    public registration closed until smoke checks complete.
12. Install the checked deploy script and a repository-scoped self-hosted runner
    with custom label `cola-production`. Keep the runner out of the Docker group;
    allow only `sudo -n /usr/local/sbin/deploy-cola`. The deploy script automatically
    selects `compose.prod.yaml` + `.env.production` when the production env file is
    present. Set the same production Compose/env files explicitly for backups.
13. Smoke-test registration (temporarily enabled), login, wizard/touch dropdowns,
    upload, public showcase, like, revoke, and a backup/restore drill.
14. Open registration only for the planned beta cohort. Email verification and
    password recovery remain separate release items before unrestricted signup.

## Monitoring and troubleshooting

External monitor: `/api/health` = process liveness; `/api/ready` = DB readiness
(503 on DB failure); `/api/status` = DB plus optional resolver readiness. Resolver
failure degrades enrichment but does not make manual bike management unavailable.
Docker app checks readiness; resolver checks its own `/ready` including persistence.
Responses carry `X-Request-ID`; error logs are JSON with that ID, event and safe
error class/code (no SQL, tokens or request bodies). Startup logs show mode/origin,
not secret values. Production Docker logs rotate at 10 MiB × 3 per container.

Monitor disk free space, backup age/off-host delivery, HTTP error rate and Docker
health. Test alerts. Inspect `docker compose logs --tail 100 app bike-resolver`.
Edge nginx limits auth by actual client IP; only a matching private proxy key makes
`X-Cola-Client-IP` trusted. Arbitrary `X-Forwarded-For` is ignored. Do not add CDN
real-IP trust without a specific provider address allowlist. App maintains account,
action and high-ceiling distributed auth limits in PostgreSQL.

## Social profiles and avatars

Migration `009_social_core.sql` adds usernames/profile fields and `user_follows`.
The existing transactional migration runner records it once; no data is removed.
Existing users get stable `rider-<UUID prefix>` names with collision suffixes.
Registration remains compatible through a database default. Username uniqueness
is enforced by a lowercase format constraint and a unique index on `lower(username)`.
Follow foreign keys cascade when an account is deleted. Blocking hides the graph
without destroying it; unblocking restores its public visibility.

Avatars use the **existing photos volume**, named `avatar-<UUID>.webp` under
`UPLOAD_DIR`. No new volume, external storage or backup secret is required.
The database records the current avatar ID and processed byte size. Uploads are
capped at 2 MiB; decoded images at 40 MP; output is metadata-free 512×512 WebP.
The avatar counts toward the user's existing storage quota (not the bike-photo
count). Replacing/removing it locks the owner row, commits the DB change, then
removes the previous file; a failed pre-commit replacement removes the new file.
If commit outcome is uncertain, retain the file for the existing orphan audit.

`audit-photo-files.js` includes avatars in its known-file set and can prune
unreferenced avatar files older than 24 hours. Administrative user deletion also
removes the avatar. The public avatar endpoint checks the current DB reference and
blocked state on every request and sends `private, no-store`; replaced/blocked
avatars immediately return 404. Already downloaded bytes cannot be recalled.

The backup drill now asserts both the restored avatar DB reference and file bytes,
in addition to the existing DB/photo markers, checksum and overwrite checks.
Continue backing up DB and the **entire** photos volume together. Rolling back to
an old application version must not run that version's orphan-pruning script over
new avatar files; use the current audit script.

## Community interactions

Migration `010_community.sql` adds comments, notifications and reports to the
existing PostgreSQL database. No new service, Redis, broker, storage volume or
backup procedure. The full DB backup includes all new tables automatically.
A publication trigger maintains `bikes.published_at` across the existing create,
wizard, edit and share paths. Existing public bikes are backfilled with created_at.

Comments are plain text (1–1000 chars); client rendering never interprets HTML or
Markdown. Same-bike FK and a depth trigger complement transactional service checks.
Deleted body text is cleared; a tombstone preserves active replies. Blocking an
author hides their text/identity publicly while keeping other authors' replies.
Deleting a user nulls comment authors instead of orphaning threads. Bike deletion
cascades its comments and notifications. Reports retain target UUIDs for moderation
history; deleted targets display as unavailable, not reconstructed snapshots.

Notifications are inserted inside the action transaction. Unique recipient/dedup
keys prevent concurrent duplicate follow/like events for the lifetime of the pair;
comment/reply keys use PostgreSQL 15-minute time buckets per actor/bike/type.
Conflicts never reset timestamps or read state. The first comment in a bucket is
the target. Coalescing can intentionally suppress further alerts until the next
window, including if that first comment was deleted. No self notifications.

Every notification read joins current actors, bikes and comments and rechecks
publication/blocking/deletion. Removed likes/follows hide their event. Republishing
or unblocking may reveal the original event again with its original read state.
No private snapshot survives revocation. Read state is scoped to the recipient.
The header count uses an indexed bounded scan of at most 100 visible unread IDs
and renders 99+; it does not aggregate full history. Only an open, visible
notification page polls (30s). Old notifications currently have no automatic
retention cleanup; monitor table/index size with normal PostgreSQL operations.

Comment creation: 20/user/15min; edits/deletes: 40; reports: 10; read mutations:
120. Reports deduplicate per reporter/entity for their lifetime. Admin report
closure and comment deletion use the existing audit log. Abuse handling remains
manual through the reports queue and existing user blocking. There is no DM,
friend-request workflow, email delivery or separate background worker.

## Gamification / Hall of Fame

Migration 011 is additive and runs through the existing migration ledger. Awards,
reactions, settings and exclusion flags are in the existing PostgreSQL database;
normal database backups include them. There are no new volumes or external services.
Deploy/restore flow is unchanged. Migration backfills milestones for existing users;
it can take time proportional to their public bikes and engagement. The current
fixed milestone evaluator uses transaction advisory locks per owner and unique
award indexes. Never disable its triggers for application writes.

Records are request-time snapshots with no cross-request cache. Privacy, exclusion
and blocking are rechecked for every result; hidden prices are SQL-redacted before
ranking. Public award history hides bike awards when their bike becomes private;
account history remains available to its owner. User milestones describe previously
public activity, not current private totals. A deleted bike cascades its bike awards.

Admin exclusions and restorations require a reason and write `admin_audit` entries
`leaderboard.exclude` / `leaderboard.restore`; settings write `gamification.settings`.
To correct junk values, exclude the bike without changing visibility, then restore it
when verified. Disabling reactions retains stored votes but removes public counts
and community titles until enabled again. The fixed currency is RUB; changing the
currency would require a deliberate data conversion policy, not relabeling amounts.

Reproduce the synthetic plan with `node scripts/explain-records.js` (isolated PGlite,
no production connection). Leaderboards scan eligible public builds in a bulk query;
monitor duration as the site grows. Normal cards add only one batch awards query.

## GPX ride storage

Compose now persists `/app/rides` separately from photos. Keep this volume in
backups; `scripts/backup.py` writes backup v2 with `rides.tar.gz` and checksums.
Restore checks both empty volumes and accepts older v1 archives. Run the backup
drill before promotion; it checks ride DB/original/geometry and restored pages.
Schedule `docker compose exec -T app node scripts/cleanup-rides.js` hourly to
expire previews and retry the file deletion outbox even when nobody uploads.
Configure trusted `MAP_STYLE_URL` in the app environment for tiles;
without it the page deliberately renders its offline SVG route. User-uploaded
style URLs are not accepted. Admin → Покатушки manages upload quotas and privacy
radii. GPX originals are private; never expose the rides volume through nginx.
