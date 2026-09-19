# Покатушки v1

A ride is a story about one owned bicycle, not an athletic activity dashboard.
Account → Покатушки imports GPX through an owner-bound, 30-minute preview. A
second request selects an owned bike and saves metadata, visibility and privacy.
The profile defaults to bicycles; rides have a separate tab. Bike pages show
public count/distance and three recent rides. `/feed` merges bike and ride
publications chronologically with SQL pagination and bulk hydration. Showcase
remains bike-first. No ride achievements, photos or training fields are added.

## Ingestion and limits

`POST /api/rides/preview` accepts binary UTF-8 GPX regardless of Content-Type.
fast-xml-parser validates XML; DTD/entities are rejected before parsing, entity
processing is disabled, nesting is bounded to 32. Defaults: 10 MiB, 200,000 raw
points, 2,000 rides/user, 10 uploads/15 minutes and 10 active previews/user.
Admin → Покатушки configures these bounded limits and allowed privacy radii.
Owner row locks serialize quota and duplicate checks. SHA-256 identifies exact
original bytes; reformatted equivalent GPX is intentionally not deduplicated.
`POST /api/rides` cannot supply geometry or metrics. A composite foreign key
also enforces bike ownership. Editing can move a ride to another owned bike.

## Metrics

Server parsing supports tracks, multiple segments, and route fallback. Distances
use Haversine within segments only. Consecutive duplicate coordinates are omitted
but update the previous timestamp, keeping stationary time out of moving time.
Nonpositive or missing intervals cannot contribute speed. Intervals exceeding
300 seconds cannot contribute moving time. GPS speeds above 45 m/s or untimed
jumps above 10 km split geometry rather than drawing a connecting line.
Elapsed time uses first/last valid timestamps; moving time sums intervals at
least 1 m/s. Average speed uses moving distance/moving time. Missing time yields
null timing/speed. Elevation uses a five-sample median and 3 m hysteresis; missing
samples reset its baseline. This is an approximate consumer metric. Thresholds
are named in `GPX_THRESHOLDS` and numeric tests have explicit tolerances.

## Privacy and public DTO

Privacy defaults off; optional radii 300/500/1,000 m. Every point within the
geographic circles around original start/end is excluded, including subsequent
visits. Gaps split the route. Sparse edges crossing a circle are also split.
Ramer-Douglas-Peucker (8 m) runs independently per visible segment; a proposed
simplification crossing a privacy zone falls back to the unsimplified segment.
Bounds and map markers use only the resulting geometry. Distance/time metrics
remain complete. Original GPX and private coordinates never enter the explicit
`publicRide` DTO. Public start time is date-only. Preview is authenticated owner
content and may show the full route before privacy is applied.

Public queries require public ride + public bike + unblocked owner. This applies
at read time to detail, profile, bike statistics, feed, likes, comments and
notifications. Making a bike private instantly hides its public rides. Account
can show private rides. There is no original GPX download endpoint.

## Storage and lifecycle

`RIDES_DIR` defaults to `rides`, production `/app/rides` has a separate persistent
Compose volume. Original files are gzip-compressed with server UUID filenames
and mode 0600, never stored in photos. A complete compressed file is written
before DB commit; failed/uncertain commits can leave an orphan, never a published
row with an incomplete file. Deletion cascades social data and records a durable
filesystem cleanup outbox, including owner deletion. Cleanup runs on ingestion
and after deletion; schedule `node scripts/cleanup-rides.js` periodically for
idle installations. Orphans are removed after 24 hours, expired previews after
30 minutes. Cleanup is idempotent. Bike deletion with rides returns 409 and asks
for reassignment/deletion. Backups v2 include checksummed rides.tar.gz; legacy v1
archives remain restorable. The drill verifies a restored row, gzip, geometry,
HTTP DTO and page.

## Maps and social

SVG previews require no tiles or network. MapLibre loads only on ride detail;
set `MAP_STYLE_URL` to a trusted style URL in the app environment.
No configured style or tile failure leaves SVG and metrics available. Providers
must retain their attribution. Client-only map code, no geocoding or routing.

Separate ride likes/comments minimize migration risk. One reply level, edit own,
soft deletion, admin moderation, idempotent likes, no self-likes/notifications,
blocked-author suppression and existing rate/origin checks are preserved.
Discussion UI and comment pagination reuse existing semantics. Ride notifications
coalesce comments in 15-minute windows and likes for their lifetime. Reports
support ride/ride_comment; admins can hide a reported ride or remove comments.

## Extension points and limitations

Future achievements can consume committed ride publication/deletion events and
bulk distance totals. No gamification rules are changed here. Future Garmin or
Strava imports should feed the same normalized ingestion/ownership/privacy path;
no integration credentials, FIT, TCX or remote sync are included.
Synthetic fixtures cover parsing, metric gaps, privacy reentry and social lifecycle.
The real Zepp GPX is used only for manual acceptance, not committed to Git.
