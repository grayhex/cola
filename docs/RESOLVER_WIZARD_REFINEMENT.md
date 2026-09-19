# Resolver and bike creation refinement

## Sources and identity

The Velostrana regression was caused by explanatory tooltip text inside labels and specifications split across four tables. Tooltip content is excluded; the small semantic source profile permits all tables inside the product specification. A real reduced fixture now yields 23 components. The supplied Specialized product 200528 has **2023** in its title and yields 25 components; it must not be silently treated as a 2024/2026 model.

Manual sources report a conflict when the title differs from requested identity tokens or an explicit source year differs. Missing year alone is uncertainty, not evidence of a different year. The wizard asks before accepting conflicting components; its trusted owner-bound preview also requires explicit acknowledgement at creation. Source title/year and raw specifications remain unchanged.

Automatic resolution keeps official discovery first. If unsuccessful, the optional `retailerSearch` setting enables one public Bing RSS search and at most three product-page fetches. Search snippets never become specifications. A fetched page must confirm the exact identity/trim tokens and model year. No LLM, browser, secret API, source mixing or anti-bot bypass. The same SSRF validation, DNS pinning, redirect validation, blocked domains, rate limiting, cancellation and response limits apply. Discovery links are cached for one hour, bounded to 100 queries; manual results are not cached. Search outages and unsuitable results are expected and lead to explicit manual choices.

## Network acceptance and limits

On 2026-09-19, fresh downloads of both user URLs returned HTTP 200 and the public Bing RSS endpoint returned valid XML. Parsing those pages is covered by offline fixtures. The production Node transport in this workspace still returned `dns_failed` before HTTP for Specialized. This does **not** establish the cause of the deployment's access error, nor prove that deployment egress works. Retry attempts now rotate among already validated public DNS addresses; no IP validation was removed. A real HTTP 403/challenge remains an error and can fall back to a retailer. The UI distinguishes DNS, timeout and denied-access errors.

## UI and settings

- Current year plus a ten-year picker; editable earlier years.
- Separate automatic status/timeline and manual-link panel, with configurable action labels/icons.
- Seven quick component starters; full catalogue editing remains available after creation.
- Factory color, weight and manufacturer-page suggestions; editable size dictionary (XS–XL defaults).
- Up to three photo suggestions, grouped compact details and optional description.
- Bike photographs require at least 600×400 (either orientation), verified server-side before re-encoding. Avatar and admin icon dimensions retain their existing policies. Failed/small remote previews are removed; local uploads are checked before saving.
- Save completion disarms the unload warning; unsuccessful saves retain it.
- Desktop bike detail uses square photography on the left and components on the right; mobile remains stacked.
- Media grouped by assigned use; three navigation icon sizes and ordering apply to actual DOM/focus order.
- Add-bike entry is in the account; alpha and repository link in footer. Self-likes are ignored without a forbidden cursor.

No migration, deployment, storage relocation or change to public data boundaries is needed. New settings/catalogue fields have backward-compatible defaults.

## Manual acceptance

1. Import the supplied Velostrana page; verify fork, brakes, drivetrain, wheels and cockpit.
2. Import Specialized 200528 with year 2024: decline the mismatch, then repeat and accept it. Check source year remains 2023.
3. Simulate official-source failure and inspect retailer search events. A wrong/unknown year must not auto-import.
4. On mobile, complete all four steps, pick a size and source metadata, reject a 100×100 image, save a valid image without a leave warning.
5. Check desktop detail, self-like, account-only creation, footer, admin media groups, menu size/order and custom wizard labels/icons.
6. Recheck Specialized from the actual resolver container network using the existing diagnostic command; do not treat a successful browser request as equivalent.
