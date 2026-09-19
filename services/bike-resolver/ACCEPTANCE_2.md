# Resolver 2.0: acceptance investigation, 2026-09-19

## Sources

1. [Specialized Stumpjumper](https://www.specialized.com/us/en/stumpjumper-15-evo-alloy-comp-sram-eagle-70-fox-rhythm/p/4221474?color=5466627-4221474)
2. [Trial-Sport Outleap Bliss Expert](https://trial-sport.ru/goods/3191714.html?color=auracloudsilver)
3. [Twitter Leopard Pro](https://twitterbikeusa.com/products/carbon-mountain-bike-leopard-pro-29-wheel-12-speed?srsltid=AU7gw4Wvy_rD1JKo5XHn_vhSfYlPtwFXBuRFEfreA2eRoJQL0I9_sIIh)

## Before changes

The old extraction functions were run against downloaded live HTML. A total failure was **not reproduced** for Specialized or Trial-Sport in current main; the historical user-observed failure cannot honestly be assigned to a selector/charset/challenge without its original request logs. Twitter did reproduce parse_error.

| Page        | HTTP / charset        | Downloaded bytes | Evidence                                                                                                            | Old result / recognized components      | Finding                                                                                                  |
| ----------- | --------------------- | ---------------: | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Specialized | 200, text/html, UTF-8 |           418584 | No JSON-LD; 1446 traversed RSC objects; Technical Specifications section; 25 table rows are not the principal specs | resolved / 22 (28 extracted raw fields) | Embedded `specs` worked; generated CSS selector was brittle. Spokes/inner tubes lacked aliases.          |
| Trial-Sport | 200, text/html, UTF-8 |           790839 | No JSON-LD/hydration objects; semantic two-column specification rows within a larger page (175 total tr)            | resolved / 17                           | Current capture has no charset/challenge failure. Separate Russian front/rear brake labels were missing. |
| Twitter     | 200, text/html, UTF-8 |           869001 | 4 JSON-LD scripts / 37 traversed objects; no table rows; product description has bold labels followed by lists      | parse_error / 0                         | Missing generic heading/list strategy and plural/alternative labels. No JS rendering required.           |

Final URLs equalled the requested URLs above after redirects. No anti-bot challenge was present in these acquired documents. Full pages are not committed or logged; regression fixtures are representative specification excerpts. Timing was not captured for the initial acquisition.

## After changes: fresh live acquisition and static extraction

The URLs were fetched again through the available development HTTP channel (curl), not reused from fixtures. All final URLs still equal the URLs above; response Content-Type is text/html; charset=utf-8. Static results below come from the production extractor over those freshly downloaded bytes.

| Page        | Fetch status |  Bytes | Fetch duration | Strategy selected           | Specification fields / recognized components | Static result                                       |
| ----------- | ------------ | -----: | -------------: | --------------------------- | -------------------------------------------- | --------------------------------------------------- |
| Specialized | 200          | 418607 |       11.159 s | repeated label/value blocks | 25 / 24                                      | resolved, complete; one unknown SWAT field retained |
| Trial-Sport | 200          | 790844 |       10.099 s | primary specification table | 19 / 19                                      | resolved, complete; both brakes included            |
| Twitter     | 200          | 868998 |        9.278 s | heading/bullet lists        | 17 / 17                                      | resolved, complete; source year remains null        |

Metadata is excluded from the coverage denominator. Static parsing took approximately 0.1–0.2 seconds per full document in this environment. Specialized suggests 16.55 kg. Twitter lists three weights for different frame sizes; only weightText is returned, never one arbitrarily chosen numeric weight. Retail prices are not suggested.

### Transport limitation, not an extraction success claim

Running `scripts/diagnose.ts` with the actual pinned Node HTTP client in this workspace returned `upstream_unavailable / dns_failed` before HTTP for all three hosts (1.519 / 1.508 / 1.512 s). The curl channel succeeded, but that does **not** prove the production container's DNS/egress path. No pinning, DNS validation or challenge protection was relaxed to make a smoke test green. End-to-end live transport must be rechecked with the documented command from the target container/network. The inspector exposes this sanitized reason; the user can try another URL or continue manually. Do not advertise these captures as proof that every deployment can fetch these domains.

## Manual acceptance checklist

- Create a bike with Giant / Contend / AR 1 / 2024 in the fixture environment; watch real trace events and counts, then review imported components.
- Paste a supported public product URL; inspect source, source-year warning and quality. Partial results can proceed to step 3.
- Review unknown/conflicting fields; explicitly apply suggested weight/color only to empty fields.
- Stop a slow resolve. Browser fetch and upstream work are cancelled; no bike is created.
- Verify the inspector as admin and reject it as anonymous/non-admin/cross-origin.
- Repeat a query: cache_checked/cache_hit appear without fictitious downloads.
- Test phone width and touch controls in Chromium/WebKit mobile; expand and collapse the trace without horizontal overflow.
- Run the live diagnostic for each original URL from a network with direct public DNS/HTTPS. If blocked, preserve the reason and do not bypass the restriction.

No merge, deployment or VM operation is part of this PR.
