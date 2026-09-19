# About and navigation maintenance

`/about` is populated from `lib/about-content.js`. The existing versioned
`site_settings` JSON stores `about` (section titles, visibility, illustration
visibility and hidden information cards) and optional `navigation` (three known
section IDs, labels and visibility). No schema migration is required. Existing
sites inherit defaults. Legacy `navOrder` is retained: before a new order is saved,
`home` and `subscriptions` determine the relative order of bikes and rides.
Account utilities have a fixed place in the new hierarchy.

Admin → Оформление/графика → Верхнее меню / О проекте controls the settings.
Illustrations use the existing asset picker and asset reference protections.
Legacy custom logo, profile, notification (`navMessagesIconId`, legacy storage key
only), subscriptions, records, admin and logout graphics still render. New slots:
`navRidesIconId`, `navAboutIconId`, `aboutGuideImageId`,
`aboutTechnologyImageId`, `aboutHistoryImageId`.
No administrator-supplied URLs or HTML are interpreted as navigation.
Hiding a navigation section is presentation, not access control; `/about` stays
reachable. Each About section and information card can independently be hidden.

## Major release checklist (include in the PR)

1. Review all three About sections against the actual shipped flows. Update user
   instructions for changed routes, parsing, privacy, ratings and achievements.
2. Update technical content for changed stack, boundaries and integrations.
3. Append dated, verifiable development milestones. Current baseline is merged
   PRs #1–25, retrieved from GitHub on 2026-09-19, first PR merged 2026-09-15.
   Keep any count explicitly dated. PR count is not prompt count; calendar span
   and workflow duration are not AI working hours.
4. Prompt count, agent hours, tokens and cost require a complete session/billing
   export with period, provider/model and pricing basis. Until that exists,
   explicitly report unavailable. Never estimate from code volume or Git commits.
5. Preserve admin titles, visibility and asset choices. New content belongs in
   defaults/code; releases must not overwrite saved editorial settings.
6. Run existing tests/build and the navigation browser test in Chromium and
   WebKit mobile. Inspect mobile overflow, keyboard dismissal/focus, configured
   assets and About content. Include results in the PR. Merge/deploy are separate
   owner decisions.

Navigation uses disclosure buttons and ordinary links (not application-menu ARIA
roles). Tab retains native document order; ArrowUp/Down/Home/End move within open
popovers. Escape restores trigger focus; outside interaction and focus departure
close. Mobile uses the existing native modal dialog for focus containment. Motion
is 170 ms and disabled with prefers-reduced-motion.

The account popover lazily reads existing authenticated account/ride APIs once
per header mount; missing statistics are omitted, not fabricated. The existing
subscription feed supports `type=rides` before counting/pagination, preserving
all visibility checks. No social model changes.
