# Community homepage and neutral design system

> Stage-one record. The completed UI and removal of obsolete settings are documented in [stage two](product-ui-completion.md).

The homepage is now an entry point to the community: hero → unified search → Live → popular bicycles → new stories and rides → current records. The full gallery lives at `/bikes`. Existing gallery bookmarks with `sort`, `category`, `q` or `page` on `/` redirect with their query intact. Existing advanced discovery remains at `/experience` and compatible advanced `/search` URLs.

## Reference study, 21 September 2026

Pirate Face and Hugging Face were opened in the authenticated browser and inspected through rendered DOM and computed styles. No source code, text, logos or graphics were copied. Production ColaBike was inspected read-only.

| Observed reference | ColaBike implementation |
| --- | --- |
| Pirate Face: Source Sans 3, 16/24 body, 46/50.6 hero heading, weight 800 | Existing locally hosted Source Sans 3, including Cyrillic, 16/24 body; 48/51.8 desktop hero, weight 750 |
| Pirate Face: 66 px navbar, max-width 1440, 24 px gutters | 66 px navbar; 1320 px content cap and 24 px desktop gutters, deliberately a little narrower for the bicycle summaries |
| Pirate Face: warm hero panel, Live at its foot, centered Trending heading with side rules, three columns | Warm neutral hero panel; uploaded bicycle image above the requested two-line heading and search; Live and three compact bicycle columns |
| Pirate Face: 38 px compact input, 8 px radius; roughly 150–180 ms transitions | 36/40 px common controls, 44 px touch controls, 6/8 px radii; 150/180 ms motion tokens; hero search is intentionally larger |
| Hugging Face: Source Sans Pro, 16/24 body, 48/48 heading; 65 px navbar, 36 px search, 8 px radius | Related Source Sans 3 family throughout; dense entity rows, neutral borders, compact metadata and understated tabs |
| Both: muted metadata and restrained surfaces | Fixed white/graphite palettes, amber accent, no pixel UI assets or decorative image backgrounds |

The current Pirate Face hero is a split composition. ColaBike uses the centered image/headline/search composition explicitly requested in the brief, with the reference's scale, panel rhythm, Live strip and Trending section. The reference mobile breakpoints were inspected in styles; the cloud browser did not expose viewport emulation, so this is **not** a claim of visual reference QA on mobile.

The new local UI was inspected at 320, 390, 768, 1024, 1440 and 1920 px, plus 844×390 landscape, in both palettes. Mobile browser coverage uses Chromium device emulation, not physical devices or WebKit. A 720 px viewport plus increased root text size tests reflow corresponding to a 1440 px viewport at 200%; native browser zoom was not automated.

## CSS ownership and compatibility

- `app/theme.css`: semantic palettes, dimensions, typography, motion and layer tokens. Compatibility names such as `--ink`, `--paper` and `--line` alias these tokens.
- `app/product-ui.css`: existing shared control primitives, now consuming the tokens. Old token definitions and pixel preset rules were removed from this file.
- `app/mobile.css`: retained feature layouts; competing light/dark roots, decorative backgrounds and duplicated shared control rules were removed.
- `global-header.module.css`, `home.module.css`, `search-box.module.css`, `discovery-search.module.css` and `site-footer.module.css`: component-owned presentation. The existing bicycle card/grid modules remain the gallery's source of geometry.
- The palette is imported before the feature styles. There is no appended redesign override stylesheet. Existing reduced-motion `!important` accessibility rules are retained; new modules do not require them for normal styling.

Source Sans 3 is already part of the repository's licensed font infrastructure, is preloaded locally, and covers Cyrillic. Existing other font files are preserved but do not determine the new UI. Standard actions use Lucide. Achievement artwork, avatars, auth/about illustrations and uploaded content images still use the asset system. Legacy icon assignments, presets and asset IDs are kept for compatibility, with their controls clearly separated in admin.

`appearance` adds an explicit site default theme and accent. Missing values receive System / `#F3B51B`; existing settings JSON is not destructively migrated. A saved personal accent remains usable with an automatically chosen black/white foreground; the account screen can reset it to the site's accent. Legacy font, banner and background choices are retained in data and ignored by the new shell. Content/layout preferences remain supported.

The theme bootstrap in `<head>` accepts only three validated enum values. It resolves `cola:theme` in local storage before hydration, falling back to the site's default and the device's color scheme. Header and account controls share the same state, respond to OS/storage changes and tolerate unavailable storage. The palette does not animate across the whole DOM. Accent is used as a fill or decoration; readable text uses neutral semantic foregrounds.

## Search and data

`GET /api/discovery/search` returns grouped, bounded DTOs for bicycles, component names and rides. The search box waits 220 ms, cancels obsolete requests, ignores stale responses, and supports arrows, Enter, Escape, outside dismissal and `/` or Ctrl/Cmd+K. Results have actual destinations; a component opens bicycles containing that component. `/search` provides type tabs, empty/error states and pagination rather than depending on the overlay.

Queries are limited to 150 characters. PostgreSQL receives parameters; case-insensitive NFKC-normalized `strpos` treats `%` and `_` literally. Public visibility and blocked-user filters are evaluated on every request. Ride results never include route geometry. Suggestions are limited to four per group; the mixed results page uses eight per group; a single type uses pages of 24. There is no new search engine or schema migration.

`GET /api/discovery/home` reuses the existing `showcase(..., {sort: 'popular'})` ranking, returning the first nine bicycles and only their first photo. Current records reuse the existing records calculation. Activity combines publication dates from public bicycles, published journal entries, public rides and actual achievement awards. Each source is limited before combining; only 16 ticker events and six content summaries are returned. New content gives journal entries priority, then rides, then bicycles. Privacy is rechecked at request time; endpoints are `private, no-store`.

There is no durable record-change event history in the existing model. The UI therefore shows current record holders in a separate block and does not manufacture “new record” events or dates. Live is a current snapshot on page load/retry; it does not add a polling or WebSocket service.

Small bicycle images use 160/320 px WebP derivatives. The existing photo route checks ownership/public visibility **before** creating a derivative, preserves alpha/aspect ratio and keeps the same private/no-store policy. No originals or asset records are rewritten. Derivatives are generated on request, with no shared cache that could outlive a privacy change.

## Admin and interaction

Admin → Design → Appearance edits only the default theme and accent. Admin → Design → Homepage uploads/selects/replaces/removes the hero image and edits its headline/subtitle. Upload uses the existing validated asset pipeline; saved hero assets participate in the existing deletion protection. Recommended source: transparent PNG/WebP, 320×320. A neutral vector bicycle is shown when no image is assigned or loading fails. No production hero artwork was generated.

Navigation preserves configured ordering/visibility/custom labels; old default labels are updated. Guest add-bike actions still continue through registration to the wizard. Like queues keep their existing optimistic rollback behavior. Follow labels update immediately and roll back on failure. Save acknowledgement now waits for the server; see the stage-two CI fix.

The ticker pauses on hover/focus and with an explicit pause control. Its single animation duplicate is both `aria-hidden` and `inert`. Mobile and reduced-motion modes use a readable static horizontal rail. Search has combobox/listbox semantics and active descendants; its keyboard selection scrolls into view. The dialog contains its results instead of clipping an absolutely positioned list. Escape dismisses suggestions first, then the dialog. Menus/dialogs retain focus handling, and touch actions have 44 px targets.

## Verification and screenshots

Run the focused backend suite:

```sh
node --test tests/community-discovery.test.js tests/discovery.test.js tests/admin.test.js tests/admin-design.test.js tests/navigation.test.js tests/photo-resolution.test.js tests/gallery-interactions.test.js tests/social-core.test.js tests/showcase.test.js tests/card-presentation.test.js
pnpm build --webpack
```

The 40 unit tests passed. New coverage checks privacy revocation, blocked users, all search types, literal wildcard/SQL-like input, component destinations, bounded thumbnails and alpha, early theme resolution/storage failure, protected hero assets, real activity types and unchanged popularity ordering.

Browser scenarios run with the disposable local database/app harness, without starting the resolver:

```sh
node scripts/test-ui.js tests/e2e/community-design.spec.js tests/e2e/gallery-interactions.spec.js tests/e2e/design.spec.js tests/e2e/navigation.spec.js tests/e2e/garage-polish.spec.js tests/e2e/social.spec.js tests/e2e/showcase.spec.js tests/e2e/journal.spec.js
```

All 40 browser scenarios passed in the final run (3.2 minutes). The local environment uses a temporary Chromium 153 executable and a configuration outside the repository for desktop and iPhone 13 Chromium emulation. Neither that browser nor a dependency change is part of the PR. The committed Playwright configuration retains its normal Chromium/WebKit projects; WebKit results are not claimed here. No heavy resolver/parser integration suite was run.

Screenshots in `docs/screenshots/community-redesign/` compare the public production desktop before with local fixture data after. Different data and viewports mean these are design comparisons, not pixel snapshots of the same state. After images show the deliberate neutral hero fallback, since no final hero artwork was supplied. The local fixtures use existing bicycle photographs, not generated images. No test content or configuration was written to production.

## Deliberately outside this stage

The information architecture of bike detail, account/profile, journal, rides, records and admin remains intact; those pages receive shared typography, colors and controls. A deeper page-by-page layout redesign, persisted record-change history, search indexing and thumbnail caching require separate work. No schema changes, taxonomy changes, resolver changes, production deploy or merge are included. CI is not monitored after opening the PR, as requested.
