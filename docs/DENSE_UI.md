# Dense public UI

Discovery update: global search now opens `/search` (bikes, journal, users).
Journal uses the existing feed with compact cards; `/saved` is personal.
Model experience pages reuse the same search/results rather than a new catalogue UI.
Primary sections: bikes, journal, rides, about; utilities remain separate.
See [DISCOVERY.md](DISCOVERY.md) for current API/migration/privacy details; historical
implementation notes below describe the original dense-UI-only release.

Journal update: showcase cards use two footer rows, with title and compact
type/color/size/weight labels above author/social/progress/achievement indicators.
Year is not repeated. Photos use `object-fit: contain`, including hover. Mobile
showcase heading and controls remain on one row; filter/sort text gives way to
accessible icons. Bike journals span the full width below photo/build/ride columns.

Implementation of [VISUAL_DESIGN_SYSTEM.md](VISUAL_DESIGN_SYSTEM.md).

## Components and ownership

- `product-ui.css`: semantic colors derived from the active theme/accent, 4px spacing,
  3/5/8px radii, flat controls, accessible focus and reduced motion. Existing
  site artwork, preferences, stock photos and background controls remain authoritative.
- `showcase.css`: one photo-first card and responsive grid across showcase,
  subscriptions, public profile and account. Metadata omits missing values;
  the title is one line with its full accessible text. Author, likes and comments
  are below the image. Only private owner cards overlay a visibility indicator.
- `header.css`: compact navigation preserving uploaded icons/logo; search opens a
  native dialog and submits to the existing showcase `q` query.
- `compact-ui.jsx`: native modal focus containment/Escape/return focus, filters,
  removable chips, metrics and one significant badge. Mobile dialogs become bottom
  sheets with a scrollable options area. Touch controls are at least 44px high.
- `card-presentation.js`: tested presentation priority: current record, rare
  milestone (100/50 likes, full build), then community title. This is not a second
  eligibility engine. Four segments use the documented 0–24/25–49/50–74/75–100
  scale; exact percentages remain available by keyboard, touch and accessible name.

## Compatibility and performance

No migrations, packages, new API routes, DTO fields, auth or deployment changes.
`GET /api/showcase?category=mtb,road` extends the existing single-value filter;
keys are validated against the site catalogue, selection is bounded to 50 and SQL
uses a parameterized text array. Empty means all. Backend/public taxonomy still
contains three categories; the filter UI has no hard-coded three-category layout.
Admin accepts 3/4/5 desktop columns (legacy 2 remains valid). Below 1100px the grid
uses two columns, and on phones one. Photo aspect ratio is still configurable.

The existing seven-query showcase remains bulk-oriented. Filter validation reads
the catalogue only for a nonempty selection. `BikeGrid` additionally requests the
existing `/api/game/records` once per displayed public collection/revision, not
once per card. That endpoint evaluates the existing global leaderboard snapshot;
this is an explicit extra cost for live current-record badges. There is no record
cache or polling. Navigation/filter changes cancel stale requests; errors simply
omit record badges. For substantially larger datasets, optimize the leaderboard
snapshot before adding more callers. No hidden prices are used by this UI.

## Validation

- Existing unit/DB tests, HTTP tests, production build and resolver tests unchanged.
- Presentation tests cover segment boundaries and priority/private suppression.
- DB tests cover multiple category filters; settings tests include five columns.
- `tests/e2e/design.spec.js`: real API-created bikes and admin settings, 3/4/5
  columns, mobile width, filters and removable chips, search, metric dialog,
  23-category synthetic catalogue, Escape/focus restoration, dark tile/cover
  background, shared profile/account cards and reduced motion.
- Both Chromium and WebKit mobile run through existing browser CI. `browser-review`
  artifacts retain screenshots on successful runs as well as failure traces for
  seven days; the deployment job is unchanged.

Screenshots use deliberately neutral local image fixtures: reliable offline layout
checks, not a claim to have reviewed every real-world uploaded image. Real iOS
hardware and production artwork remain useful manual acceptance checks.

## Manual acceptance

1. Set 3, 4 and 5 columns in admin; inspect short/long titles and missing metadata.
2. Open filters, select multiple categories, apply/remove/reset; repeat at 390px.
3. Search from header; follow author, comments and bike links; like as another user.
4. Open exact metric values by touch/keyboard; check only one significant status.
5. Inspect profile, subscriptions, notifications, account and discussion.
6. Try light/dark themes, custom icons/logo, stock photo, photo ratio, no background,
   tiled and cover artwork; check narrow layouts and reduced motion.

## Two-level navigation and About

The global header now has bike/ride disclosures, a direct About link, and separate
search/notifications/account controls. Mobile moves sections and account into a
native dialog. See [ABOUT.md](ABOUT.md) for compatibility, settings, keyboard
behavior and the mandatory major-release content review checklist.
