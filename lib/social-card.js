// Branded 1200x630 preview cards (#72). next/og (satori) draws them with the
// Geist font it bundles: no font files to ship, no system fonts, no network.
import { createElement as h } from "react";
import { ImageResponse } from "next/og.js";
import sharp from "sharp";
import { categoryFilterLabels } from "./bike-classification.js";
import { journalKinds } from "./journal-kinds.js";
import { listingPriceLabel } from "./market-types.js";
import { defaultRideFields, formatRideMetric } from "./garmin-fields.js";
import { routePaths } from "./ride-geometry.js";
import { isGeneratedUsername } from "./usernames.js";
import { plural } from "./plural.js";

export const cardWidth = 1200,
  cardHeight = 630;
// Part of the cache key: bump it to rebuild every card after a design change.
export const cardVersion = 1;
const ink = "#F3F0E8",
  muted = "#C9C4B8",
  accent = "#C2410C",
  dark = "#111315";
const kindLabels = {
  bike: "Велосипед",
  journal: "Журнал",
  ride: "Покатушка",
  market: "Рынок",
  profile: "Профиль",
};

// Code points the bundled font draws. Satori fetches anything else (emoji,
// other scripts) from Google Fonts or a CDN and sends the text along, so such
// characters become spaces instead.
// prettier-ignore
const drawable = [
  [0x20, 0x7e], [0xa0, 0xac], [0xae, 0x113], [0x116, 0x12b], [0x12e, 0x137],
  [0x139, 0x13e], [0x141, 0x148], [0x14a, 0x14d], [0x150, 0x17e],
  [0x400, 0x45f], [0x490, 0x493], [0x496, 0x497], [0x49a, 0x49b], [0x4a2, 0x4a3],
  [0x4ae, 0x4b3], [0x4b6, 0x4b7], [0x4ba, 0x4bb], [0x4c0, 0x4c0], [0x4cf, 0x4cf],
  [0x4d8, 0x4d9], [0x4e2, 0x4e3], [0x4e8, 0x4e9], [0x4ee, 0x4ef],
  [0x2013, 0x2014], [0x2018, 0x201a], [0x201c, 0x201e], [0x2020, 0x2022],
  [0x2026, 0x2026], [0x2030, 0x2030], [0x2039, 0x203a], [0x20ac, 0x20ac],
  [0x20bd, 0x20bd], [0x2116, 0x2116], [0x2122, 0x2122], [0x2190, 0x2199],
];
const drawn = (ch) => {
  const cp = ch.codePointAt(0);
  return drawable.some(([from, to]) => cp >= from && cp <= to);
};
export function cardText(value, limit = 90) {
  const text = Array.from(String(value ?? ""), (ch) => (drawn(ch) ? ch : " "))
    .join("")
    .split(" ")
    .filter(Boolean)
    .join(" ");
  return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + "…";
}

const day = (date) => {
  const value = date ? new Date(date) : null;
  return value && !Number.isNaN(value.getTime())
    ? value.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
};

// Title, one line of context and short chips per kind. `card` holds only
// fields the public page shows; ride metrics follow the owner's choice.
export function cardContent(kind, title, card = {}) {
  const content = {
    kind,
    label: kindLabels[kind],
    title: cardText(title, kind === "ride" ? 54 : 64),
    meta: "",
    chips: [],
    author: cardText(card.author, 40),
    stat: "",
    route: [],
  };
  if (kind === "bike") {
    content.meta = [
      [card.brand, card.model].filter(Boolean).join(" "),
      card.year,
    ]
      .filter(Boolean)
      .join(" · ");
    content.chips = [categoryFilterLabels[card.category]];
  } else if (kind === "journal") {
    content.meta = card.bike;
    content.chips = [journalKinds[card.kind]];
  } else if (kind === "ride") {
    const shown = card.metrics || defaultRideFields;
    if (shown.includes("distanceM"))
      content.stat = formatRideMetric(card.distance, "distance") || "";
    content.meta = card.bike;
    content.chips = [
      card.status === "completed"
        ? day(card.date)
        : card.status === "cancelled"
          ? "Отменена"
          : "Запланирована",
    ];
    content.route = routePaths(card.geometry || [], 520, 400, 24);
  } else if (kind === "market") {
    content.meta = listingPriceLabel({
      price: card.price,
      currency: card.currency,
      listingType: card.listingType,
    });
    content.chips = [card.location];
  } else if (kind === "profile") {
    content.meta =
      card.username && !isGeneratedUsername(card.username)
        ? "@" + card.username
        : "";
    const bikes = Number(card.bikes) || 0;
    content.chips = [
      card.location,
      bikes
        ? bikes + " " + plural(bikes, "велосипед", "велосипеда", "велосипедов")
        : "",
    ];
  }
  content.meta = cardText(content.meta, 60);
  content.stat = cardText(content.stat, 16);
  content.chips = content.chips.map((c) => cardText(c, 28)).filter(Boolean);
  return content;
}

const box = (style, ...children) =>
  h("div", { style: { display: "flex", ...style } }, ...children);
const svgImage = (svg, width, height, style = {}) =>
  h("img", {
    src: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
    width,
    height,
    style,
  });
const bikeMark = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="300" viewBox="400 90 400 220"><g fill="none" stroke="${ink}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><circle cx="480" cy="240" r="65"/><circle cx="720" cy="240" r="65"/><path d="M480 240l65-100 80 100H480l125-90h60l55 90M535 130h45M655 125h35"/></g></svg>`;
const routeImage = (paths) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="400" viewBox="0 0 520 400"><g fill="none" stroke-linecap="round" stroke-linejoin="round">${paths
    .map((d) => `<path d="${d}" stroke="${accent}" stroke-width="7"/>`)
    .join("")}</g></svg>`;

function header(label) {
  return box(
    { justifyContent: "space-between", alignItems: "center" },
    box(
      {
        padding: "10px 22px",
        borderRadius: 999,
        background: "rgba(17,19,21,0.66)",
        border: "1px solid rgba(243,240,232,0.3)",
        color: ink,
        fontSize: 26,
      },
      label,
    ),
    box(
      { alignItems: "center", color: ink, fontSize: 32 },
      box({
        width: 14,
        height: 14,
        borderRadius: 7,
        background: accent,
        marginRight: 12,
      }),
      "ColaBike",
    ),
  );
}
function footer(content) {
  return box(
    { justifyContent: "space-between", alignItems: "center", marginTop: 24 },
    box(
      {},
      ...content.chips.map((chip) =>
        box(
          {
            marginRight: 12,
            padding: "8px 18px",
            borderRadius: 999,
            background: "rgba(243,240,232,0.16)",
            color: ink,
            fontSize: 24,
          },
          chip,
        ),
      ),
    ),
    content.author ? box({ color: muted, fontSize: 26 }, content.author) : null,
  );
}
function text(content, titleSize) {
  return box(
    // A soft shadow keeps white text readable on bright parts of a photo.
    { flexDirection: "column", textShadow: "0 2px 16px rgba(0,0,0,0.45)" },
    box(
      { fontSize: titleSize, lineHeight: 1.08, color: ink, letterSpacing: -1 },
      content.title,
    ),
    content.stat
      ? box(
          { fontSize: 88, marginTop: 18, color: accent, letterSpacing: -2 },
          content.stat,
        )
      : null,
    content.meta
      ? box({ fontSize: 32, marginTop: 14, color: muted }, content.meta)
      : null,
    footer(content),
  );
}
const frame = (background, ...children) =>
  box(
    {
      position: "relative",
      width: cardWidth,
      height: cardHeight,
      background: dark,
    },
    ...background,
    box(
      {
        position: "absolute",
        left: 0,
        top: 0,
        width: cardWidth,
        height: cardHeight,
        padding: "44px 56px 48px",
        flexDirection: "column",
        justifyContent: "space-between",
      },
      ...children,
    ),
  );

export function cardLayout(content, photo = null) {
  if (content.route.length)
    return frame(
      [
        svgImage(routeImage(content.route), 520, 400, {
          position: "absolute",
          right: 56,
          top: 150,
        }),
      ],
      header(content.label),
      box({ width: 560 }, text(content, 54)),
    );
  if (photo && content.kind === "profile")
    return frame(
      [
        h("img", {
          src: photo,
          width: 300,
          height: 300,
          style: {
            position: "absolute",
            right: 96,
            top: 150,
            borderRadius: 150,
          },
        }),
      ],
      header(content.label),
      box({ width: 700 }, text(content, 64)),
    );
  if (photo)
    return frame(
      [
        h("img", {
          src: photo,
          width: cardWidth,
          height: cardHeight,
          style: { position: "absolute", left: 0, top: 0 },
        }),
        box({
          position: "absolute",
          left: 0,
          top: 0,
          width: cardWidth,
          height: cardHeight,
          backgroundImage:
            "linear-gradient(180deg, rgba(17,19,21,0.55) 0%, rgba(17,19,21,0) 24%, rgba(17,19,21,0.35) 42%, rgba(17,19,21,0.86) 66%, rgba(17,19,21,0.96) 100%)",
        }),
      ],
      header(content.label),
      text(content, 64),
    );
  return frame(
    [
      svgImage(bikeMark, 520, 300, {
        position: "absolute",
        right: 48,
        top: 96,
        opacity: 0.12,
      }),
    ],
    header(content.label),
    text(content, 64),
  );
}

// `photo` is a data URL already cropped to the card; returns JPEG bytes.
export async function renderCard(content, photo = null) {
  const response = new ImageResponse(cardLayout(content, photo), {
    width: cardWidth,
    height: cardHeight,
  });
  const png = Buffer.from(await response.arrayBuffer());
  return sharp(png).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}
