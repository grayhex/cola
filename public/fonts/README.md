# Local fonts

Three families from the redesign (#104), all with Latin and Cyrillic glyphs:

- Unbounded — headings;
- Manrope — interface and text;
- JetBrains Mono — numbers, specifications and records.

They are variable WOFF2 files taken unchanged from the `@fontsource-variable/unbounded`, `@fontsource-variable/manrope` and `@fontsource-variable/jetbrains-mono` packages, version 5.3.0, which subset the fonts of the official [Google Fonts repository](https://github.com/google/fonts). Each subset (`cyrillic`, `latin`, `latin-ext`) has its own file; `app/fonts.css` declares them with `unicode-range` and `font-display: swap`, so a page downloads only the subsets its text needs. `latin-ext` holds the ruble sign; headings fall back to Manrope for it. The SIL Open Font License of each family is included next to its files. No external font service is contacted.
