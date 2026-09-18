# ColaBike Visual Design System

> Status: target direction for the public/social UI.  
> Scope: visual system, interaction patterns and presentation rules.  
> This document is intentionally product- and implementation-oriented. It is not a pixel-perfect mockup.

## 1. Product character

ColaBike is a social showcase for bicycles: the bike is the hero, the owner and community create social proof, and achievements/records add character.

The visual system must combine two layers:

1. **Functional UI** — dense, calm, precise, flat, predictable and restrained.
2. **Brand layer** — expressive illustrations, ColaBike orange/red accent, achievements, bike photography and community personality.

The functional layer should feel closer to a polished network/control product than to a lifestyle landing page. The brand should appear in selected moments, not on every control.

### Reference qualities

The target qualities are:

- high information density without clutter;
- restrained surfaces and borders;
- strong hierarchy;
- compact controls;
- predictable component behavior;
- subtle, fast motion;
- clear hover/focus/selected states;
- minimal decorative chrome;
- bike photography first.

UniFi is a useful reference for density, restraint, interaction polish and systematic spacing, but ColaBike should not copy UniFi visual assets or layouts.

## 2. Core principles

### 2.1 Photo first

On showcase/feed/profile grids, the bike photo is the dominant element.

UI should not compete with the image. Avoid multiple floating controls, badges and stickers on top of photos.

Allowed photo overlays:

- private/visibility state for owner views;
- one critical contextual control when necessary;
- temporary hover affordance.

Category, likes, comments, metrics and owner information should normally live below the image.

### 2.2 Dense, not cramped

ColaBike should use high density on desktop.

Dense means:

- short control heights;
- small but deliberate gaps;
- compact metadata;
- few redundant labels;
- progressive disclosure.

Dense does **not** mean:

- tiny illegible text;
- controls touching each other;
- multiple competing rows of chips;
- showing every available data point.

### 2.3 Progressive disclosure

Show only what helps the user scan and decide.

Secondary information belongs in:

- tooltips;
- popovers;
- drawers;
- expanded detail pages;
- hover/focus states;
- explicit “more” actions.

The showcase card is not a mini detail page.

### 2.4 Flat surfaces

Default surfaces should be flat.

Use:

- 1 px borders;
- subtle surface/background contrast;
- controlled accent color;
- state changes.

Avoid:

- heavy shadows;
- floating-card aesthetics everywhere;
- glow;
- gradients used only for decoration;
- oversized rounded pills.

### 2.5 Strict geometry

Rounded corners should be restrained.

Recommended radius scale:

- `--radius-xs: 3px`
- `--radius-sm: 5px`
- `--radius-md: 8px`

Do not normally exceed 8 px for product UI surfaces.

Exceptions:

- avatars may be circular;
- notification dots may be circular;
- intentionally branded illustration assets may use their own shape.

### 2.6 Accent is scarce

The ColaBike accent color is for emphasis, not decoration.

Use accent for:

- active/selected state;
- primary action;
- important achievement/record;
- interaction feedback;
- small brand details.

Do not make every icon, metric and border orange/red.

## 3. Foundations

## 3.1 Color roles

Keep the existing theme architecture, but organize colors by semantic role.

Recommended light-mode roles:

- `--ink`: primary text;
- `--muted`: secondary text;
- `--subtle`: tertiary text;
- `--line`: standard border/divider;
- `--line-strong`: selected/hover border;
- `--paper`: primary surface;
- `--wash`: secondary surface;
- `--accent`: ColaBike accent;
- `--accent-soft`: very low-opacity accent background;
- `--danger`: destructive/error;
- `--success`: successful state only where semantic color is useful.

Dark mode should preserve roles rather than invert individual hard-coded colors.

Functional UI should not rely on white drop-shadows around illustrated icons.

## 3.2 Typography

Keep Manrope as the default product typeface unless a future typography project changes it.

Use fewer weights and clearer roles.

Recommended desktop scale:

- Page title: 36–44 px / 700
- Section title: 24–28 px / 700
- Card title: 17–20 px / 600–700
- Primary UI text: 13–14 px / 500
- Secondary/meta: 12–13 px / 400–500
- Tertiary label: 11–12 px / 500

Avoid 800 weight for ordinary UI. Reserve very heavy weight for brand/logo or rare editorial emphasis.

Large 60+ px headings should be limited to true hero/editorial contexts, not routine product pages.

Use tabular numerals where changing numeric values benefit from alignment.

## 3.3 Spacing

Base spacing unit: 4 px.

Preferred rhythm:

- 4 px — tight internal relationship;
- 8 px — default compact gap;
- 12 px — control/card sub-section gap;
- 16 px — card padding / related groups;
- 24 px — section separation;
- 32 px — large section separation.

Avoid arbitrary one-off margins where a token can be used.

## 3.4 Control sizing

Desktop is intentionally dense.

Recommended heights:

- icon-only control: 32–36 px;
- compact text button: 34–36 px;
- standard input/select: 36–40 px;
- primary action: 38–40 px.

On touch layouts, preserve comfortable hit targets even if the visual icon is smaller. Aim for approximately 44 px interactive area where practical.

## 3.5 Borders and elevation

Default card/surface:

- 1 px neutral border;
- no shadow.

Hover:

- slightly stronger border;
- optional small background change;
- no floating “material card” effect.

Selected:

- accent border or accent inset indicator;
- optional `accent-soft` background.

Dialogs/popovers may use a very restrained shadow because they need true elevation.

## 4. Motion

Motion should be subtle but present.

Recommended durations:

- hover/color/border: 120–160 ms;
- image micro-scale: 160–200 ms;
- popover/drawer: 180–220 ms;
- page-level content fade: only when it improves continuity.

Preferred behavior:

- no bounce;
- no spring overshoot for routine UI;
- no large translations;
- no continuous decorative animation.

Bike-card photo hover may use approximately `scale(1.01–1.015)`.

Respect `prefers-reduced-motion`.

Animation must never delay an action or make high-density scanning slower.

## 5. Global shell and navigation

The illustrated ColaBike logo/header can remain an expressive brand surface.

Navigation controls should be visually quieter than the brand artwork.

### Rules

- active nav state must be obvious without a heavy filled tile;
- illustrated custom icons are allowed in the global navigation;
- functional controls elsewhere should prefer the normal icon system;
- tooltips are required for icon-only navigation on desktop;
- unread badges should be compact;
- avoid giving every nav item a different decorative treatment.

### Search

Search is expected to become a global product function.

Target architecture:

- search entry lives in global navigation/header rather than inside the showcase category toolbar;
- it may begin as an icon trigger;
- future search may cover bikes, users, brands and components;
- do not permanently reserve a wide search field in the showcase toolbar.

Until global search is fully implemented, existing search capability may be exposed through a compact search trigger/panel without inventing a new backend.

## 6. Showcase header and controls

The current showcase controls should be reorganized into a compact toolbar.

Recommended information hierarchy:

**Left**

- section title;
- optional small result count / context.

**Right**

- sort;
- filters;
- add bike action when appropriate.

Do not present “Новые / Популярные / Рекордсмены” as three large independent buttons.

They are one data-mode/sort dimension.

Preferred patterns:

1. compact segmented control when there are only 3 stable options; or
2. compact selector: `Сортировка: Новые`.

The control must not visually compete with the page title.

### Category filters

Do not render all bike categories as a permanent row of image buttons.

The number of categories may grow significantly.

Use a scalable filter trigger:

`Фильтры`  
or  
`Фильтры · 2`

Desktop:

- compact popover/panel;
- categories shown as checkboxes/list items;
- room for future filter groups.

Mobile:

- bottom sheet or full-width drawer/panel.

Future groups can include:

- bike category;
- brand;
- year;
- weight;
- price;
- achievements/records.

Active filters may appear below the toolbar as removable compact chips.

Do not show a permanent “Все велосипеды” control. No active category filter already means “all”.

## 7. Showcase grid

The number of columns is configurable in admin and must remain configurable.

The card system must work cleanly at **3, 4 and 5 columns** on wide desktop layouts.

Do not hard-code a visual composition that only looks good at one card width.

Responsive card behavior should be driven by available width and existing admin settings.

At narrower widths:

- metadata should collapse before typography becomes unreadable;
- cards may reduce columns;
- never create horizontal page overflow.

## 8. Bike card anatomy

The target bike card is visually simple and photo-led.

Recommended anatomy:

1. photo;
2. compact identity/meta line;
3. bike title;
4. owner + social signals;
5. two tiny bike-level indicators;
6. at most one important badge/record.

The exact ordering may be adjusted during implementation if visual testing shows a clearer hierarchy.

## 8.1 Photo area

The image should dominate the card.

Target behavior:

- stable aspect ratio across a grid;
- `object-fit` chosen consistently;
- no unnecessary inner padding;
- image itself is the primary click target;
- very small hover scale;
- no permanent like control floating over the image;
- no decorative drop-shadow on category artwork over the image.

A card should still look good when the source image background is white, studio gray or outdoor photography.

## 8.2 Identity/meta

Only key information should appear in the scan line.

Examples:

`2026 · Gravel · 8.9 кг`

or, depending on available data:

`2020 · City · L`

Do not reserve four fixed metadata columns with empty cells.

Render only present, useful values.

Color is lower priority than year/category/weight and can move to detail view unless product testing shows it helps.

## 8.3 Bike title

Bike title is the strongest text element after the photo.

Rules:

- 1 line in dense grid by default;
- ellipsis if necessary;
- full value available by accessible title/tooltip or detail page;
- avoid visually competing author text on the same heading baseline if it harms scanability.

## 8.4 Owner and social row

Show the owner as a compact identity:

- small avatar;
- `@username` or display name according to available social DTO;
- profile link.

Likes/comments should be compact inline signals in the same lower-information area.

Example concept:

`[avatar] @grayhex                 ♡ 24   ◌ 6`

Exact iconography should use the existing icon system and accessible labels.

Do not make a large heart sticker the most saturated object after the bike photo.

## 8.5 Bike metrics

“Заполненность” and “Прокаченность” remain useful, but should not look like two dashboard progress widgets inside every public card.

Replace full labels + percentage progress bars with a compact reusable **micro-indicator**.

Target concept:

- one small semantic icon/glyph for completeness;
- one small semantic icon/glyph for upgrade level;
- each followed by a tiny 3–4 segment level indicator, or another equivalently compact visual;
- no long label on the card;
- exact name/value exposed through tooltip/title and accessible label.

Approximate level must be readable at a glance.

Suggested mapping for a 4-segment indicator:

- 0–24 → 1/4;
- 25–49 → 2/4;
- 50–74 → 3/4;
- 75–100 → 4/4.

Completeness should stay neutral/ink-oriented.

Upgrade may use restrained accent.

The bike detail/account screens may still show exact numeric values where useful.

## 8.6 Achievements and records

Public grid cards should show **at most one** significant status badge by default.

Priority recommendation:

1. current global/category record;
2. rare/high-value achievement;
3. notable community title.

Do not display ordinary milestone badges if they add noise.

Badge treatment:

- compact;
- flat;
- small accent detail;
- not a large pill;
- no multiple bright colors.

If there are more achievements, they belong on the bike detail/profile/records surfaces.

## 8.7 Card interaction

Default:

- neutral border;
- no shadow.

Hover/focus:

- border becomes slightly stronger;
- photo scales very slightly;
- title may shift to accent only if it remains restrained;
- pointer interaction remains obvious.

Do not move the whole card several pixels vertically.

The entire card does not need to be a single link if nested actions exist. Maintain correct interactive semantics.

## 9. Bike detail page

The detail page can expose much more information than the grid, but should use the same visual hierarchy.

Priorities:

1. bike identity and hero photo;
2. owner/social proof;
3. important record/achievement;
4. specs/components;
5. community reactions;
6. discussion;
7. secondary metadata.

Use dividers and spacing more than nested bordered cards.

Avoid “card inside card inside card”.

Exact completeness/upgrade values are appropriate here.

## 10. Public profile and account

Profiles should feel like a rider’s collection, not an admin form.

Public profile header:

- compact avatar;
- display name + username;
- short bio/location;
- small social counts;
- follow state;
- only important badges/current records.

Then the bikes become the main visual content.

The private account may use denser utility UI, but must share the same tokens, typography and control rules.

## 11. Feed, records and notifications

### Feed

Reuse the same BikeCard primitives wherever possible.

Do not invent a visually different bike card for each page.

### Records

Records are allowed more brand expression than ordinary UI.

Large record hero cards can be editorial, but supporting controls should remain compact and flat.

### Notifications

Notifications are utility-first:

- dense rows;
- clear actor/avatar;
- readable action;
- muted timestamp;
- obvious unread state;
- no oversized cards.

## 12. Iconography

There are two icon layers.

### Functional icons

Use the existing Lucide-based system for:

- search;
- filter;
- sorting;
- comments;
- menu;
- edit;
- delete;
- visibility;
- controls.

Keep stroke weight and rendered size consistent.

### Branded illustrations

Use custom ColaBike graphics for:

- logo/header identity;
- navigation when intentionally configured;
- category art in editorial/illustrative contexts;
- achievements/records;
- hero sections.

Do not use a large branded illustration where a small neutral utility icon communicates the action better.

## 13. Background artwork

Site background artwork remains configurable in admin.

The UI must work correctly with:

- no custom background;
- subtle tiled background;
- scaled full background;
- different background opacity settings.

Product surfaces must preserve readability regardless of the configured art.

Do not bake the current screenshot background into component styling.

## 14. Responsive rules

### Desktop

Optimize for density and fast scanning.

- compact toolbar;
- 3–5 configurable grid columns;
- hover states;
- popover filters;
- tooltips for icon-only controls.

### Mobile

Do not simply shrink desktop.

- preserve bike photo prominence;
- controls use comfortable hit targets;
- filters move to a sheet/panel;
- no horizontal overflow;
- metadata reduces before font size becomes too small;
- title/social information remains easy to scan;
- hover-only information must have touch alternatives.

## 15. Accessibility

Visual polish must not weaken accessibility.

Required:

- keyboard-visible focus;
- semantic buttons/links;
- `aria-pressed` for toggle actions;
- labels for icon-only controls;
- tooltips must not be the only source of essential information;
- adequate text/border contrast;
- reduced-motion support;
- touch targets on mobile;
- no interaction state encoded only by color.

## 16. Implementation guidance

The current code already has reusable UI pieces such as:

- `app/ui/bike-card.jsx`;
- `app/ui/bike-meters.jsx`;
- `app/ui/global-header.jsx`;
- `app/ui/community-controls.jsx`;
- `app/ui/achievements.jsx`;
- `app/ui/social-primitives.jsx`;
- `app/showcase.css`;
- `app/globals.css`;
- `app/mobile.css`.

Prefer improving reusable primitives over adding page-specific CSS exceptions.

### Target refactor direction

Create or normalize small reusable primitives where useful:

- compact icon button;
- compact selector/menu;
- filter trigger + filter panel;
- micro metric indicator;
- social stat;
- compact badge;
- surface/divider rules;
- tooltip behavior.

Do not introduce a large UI framework solely for this redesign.

Keep current theme/admin customization working.

## 17. Anti-patterns

Avoid:

- large pill buttons for ordinary filters;
- permanent rows of category picture buttons;
- full progress bars on every public bike card;
- like controls floating permanently on bike photos;
- multiple bright badges per card;
- decorative shadows on routine surfaces;
- excessive rounded corners;
- large empty padding;
- giant headings on utility screens;
- more than one accent competing in the same compact area;
- bespoke card layouts on showcase/feed/profile;
- hiding essential actions only behind hover;
- redesigning backend/data models just to achieve visual polish.

## 18. Acceptance criteria for the first redesign pass

A redesign aligned with this document should achieve all of the following:

- the bike photo is clearly the first visual focus of each card;
- cards look clean at 3, 4 and 5 columns;
- filters remain usable if the site grows to 20+ bike categories;
- “new/popular/records” behaves visually as one sort/mode control;
- search no longer occupies the showcase filter model and is ready to become global;
- completeness/upgrade consume dramatically less card space;
- no more than one important award appears on a normal grid card;
- likes/comments/owner are present but visually secondary to the bike;
- public surfaces use flat borders rather than card shadows;
- corners are restrained;
- motion is visible but subtle;
- desktop remains dense;
- mobile remains comfortable to tap;
- existing themes, configurable grid, site assets and background settings keep working;
- no privacy/security/public DTO behavior is weakened.

## 19. Design review checklist

Before merging future UI work, review it against these questions:

1. Is the bike/photo still the hero?
2. Is every visible item necessary for scanning?
3. Could any secondary item move to progressive disclosure?
4. Does the component work at 3, 4 and 5 grid columns?
5. Does it work with a plain background and a configured illustrated background?
6. Is accent color being used sparingly?
7. Is the component flat by default?
8. Are corners restrained?
9. Is the desktop layout dense without becoming illegible?
10. Are mobile hit targets still usable?
11. Are interaction states clear for mouse, keyboard and touch?
12. Is the same UI primitive already available elsewhere?
13. Does the change preserve privacy and explicit public DTO boundaries?
