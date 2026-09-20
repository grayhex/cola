# Local fonts

Manrope, Inter, Roboto, Open Sans, Source Sans 3, Noto Sans, Montserrat, Rubik, Onest and Golos Text originate from the corresponding `ofl/<family>` directories of the official [Google Fonts repository](https://github.com/google/fonts).

The distributed variable TTF files were converted losslessly to WOFF containers using fontTools; glyphs and names were not modified. Each family includes its original SIL Open Font License in this directory. `app/fonts.css` declares local faces with `font-display: swap`; only selected faces are downloaded by the browser. No Google Fonts service request is required.
