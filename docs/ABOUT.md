# About and navigation maintenance

`/about` contains the user guide and technical architecture from
`lib/about-content.js`. The AI history and bottom call-to-action links were
removed at the owner's request. Old saved history settings remain accepted for
compatibility but are not rendered or offered in admin.

Admin → Дизайн → О проекте controls section titles, visibility, information cards
and illustrations. Top-level navigation remains under Дизайн → Оформление:
known bike/ride/about destinations, order, visibility, labels and custom graphics.
Legacy asset slots and the illustrated logo remain supported. The header now uses
one compact artwork surface, with transparent navigation instead of a separate
plate. Hidden menu entries are presentation, not access control.

For every major product update, review both About sections against shipped flows
and stack. Preserve saved labels, visibility and asset choices. Update this guide
and browser acceptance as needed. Do not reintroduce AI cost/prompt/time estimates.

Navigation disclosures retain native Tab behavior plus ArrowUp/Down/Home/End,
Escape/trigger focus restoration and outside close. Mobile uses a native dialog.
Admin has keyboard-operable category tabs: Система, Дизайн, Пользователи,
Механики, Каталог, with the existing editors as second-level sections. Global
settings drafts survive category changes; settings continue using version checks.

Bike detail: wide screens use photo/build/rides columns; narrower screens follow
photo/build/rides order. Existing visibility and variant settings remain, but this
explicit detail layout takes precedence over legacy block ordering. Ride display
is the viewer's saved profile preference: auto uses cards through five rides and
collapsible items above five, or explicit cards/list. Pagination uses total count;
rides are no longer cut off at three. Hidden accordion maps load only when opened.

See RIDES.md for map providers and privacy. PR validation covers Chromium and
WebKit mobile, settings persistence, map loading/fallback and responsive columns.

The bike journal now lives below those columns; see JOURNAL.md for publication,
snapshots and inherited media privacy. About includes aggregate public garage
statistics (users exclude blocked accounts), controlled by `showAboutStats`.
Graphics settings group navigation, social/utility icons, component icons and
login/registration illustrations. Ten locally hosted modern fonts supplement
legacy system choices; family licenses accompany the files in `public/fonts`.
