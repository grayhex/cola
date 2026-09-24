# Local fonts

Both families are served locally with `font-display: swap` from `app/styles/fonts.css`; no external font service is contacted.

- **Source Sans 3** is the interface family for every text role. It includes Latin and Cyrillic glyphs. The variable TTF originates from `ofl/sourcesans3` in the official [Google Fonts repository](https://github.com/google/fonts/tree/main/ofl/sourcesans3). It was converted losslessly to a WOFF container with fontTools; glyphs and names were not modified. License: `sourcesans3-OFL.txt`.
- **IBM Plex Mono** (weights 400 and 600, Latin and Cyrillic subsets) is used only for technical labels, counters and tables (see `DESIGN.md`). The WOFF2 files are unmodified copies from the `@fontsource/ibm-plex-mono` 5.3.0 package. License: `ibmplexmono-OFL.txt`.
