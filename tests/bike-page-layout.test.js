import test from "node:test";
import assert from "node:assert/strict";
import {
  bikeExcerpt,
  bikeSubtitle,
  defaultBlocks,
  defaultGroups,
  detailLayout,
} from "../lib/garage-layout.ts";
import { overviewPanels, passportRows } from "../lib/bike-passport.ts";

// Intl groups thousands with a no-break space: compare with a plain one.
const plain = (text) => text.replace(/[\u00a0\u202f]/g, " ");
const rub = (value) => Number(value).toLocaleString("ru-RU") + " ₽";
const bike = (extra = {}) => ({
  category: "urban_touring",
  classification: {
    category: "urban_touring",
    subtype: "trekking",
    uses: ["commuting", "touring"],
  },
  brand: "Cube",
  model: "Travel SL",
  trim: "",
  year: 2020,
  size: "L",
  color: "Графит",
  weight: 14.5,
  is_former: false,
  mileage: 4200,
  price: 95000,
  show_bike_price: true,
  manufacturer_url: "https://www.cube.eu/",
  description: "",
  group_order: [],
  components: [],
  ...extra,
});
const part = (section, category, name, group_id) => ({
  id: category + name,
  section,
  category,
  name,
  group_id,
});

test("the saved blocks switch parts of the fixed composition; the overview is always on", () => {
  assert.deepEqual(detailLayout(undefined), {
    metrics: true,
    photos: true,
    thumbnails: true,
    overview: true,
    specifications: true,
  });
  const set = (patch) =>
    defaultBlocks.map((b) => ({ ...b, ...(patch[b.id] || {}) }));
  // An old default switched the summary off and folded blocks: that was
  // never a choice about this layout.
  assert.equal(
    detailLayout(set({ summary: { enabled: false, open: false } })).overview,
    true,
  );
  assert.equal(
    detailLayout(set({ gallery: { open: false } })).thumbnails,
    true,
  );
  assert.equal(
    detailLayout(set({ heading: { enabled: false } })).metrics,
    false,
  );
  assert.equal(
    detailLayout(set({ specifications: { enabled: false } })).specifications,
    false,
  );
  // The thumbnails belong to the picture: no picture, no row under it.
  const noPhotos = detailLayout(set({ photos: { enabled: false } }));
  assert.equal(noPhotos.photos, false);
  assert.equal(noPhotos.thumbnails, false);
  assert.equal(
    detailLayout(set({ gallery: { enabled: false } })).thumbnails,
    false,
  );
  // A block missing from an older saved list falls back to its default.
  assert.equal(detailLayout([]).specifications, true);
});

test("the excerpt never repeats the whole description", () => {
  assert.equal(bikeExcerpt(""), null);
  assert.equal(bikeExcerpt(null), null);
  assert.equal(bikeExcerpt("   "), null);
  // One short paragraph is the whole text: «About the bike» shows it.
  assert.equal(bikeExcerpt("Мой городской велосипед."), null);
  // The first paragraph, when the description goes on.
  assert.equal(
    bikeExcerpt("Мой городской велосипед.\n\nИ ещё немного про ремень."),
    "Мой городской велосипед.",
  );
  assert.equal(
    bikeExcerpt("Строка один\nстрока   два\n\nВторой абзац"),
    "Строка один строка два",
  );
  // A long first paragraph is cut at a word and marked.
  const long = "слово ".repeat(60).trim();
  const excerpt = bikeExcerpt(long, 50);
  assert.ok(excerpt.endsWith("…"));
  assert.ok(excerpt.length <= 51);
  assert.ok(!/\sсл…$/.test(excerpt), "no half a word before the ellipsis");
  assert.ok(long.startsWith(excerpt.slice(0, -1)));
});

test("the passport holds general facts from filled fields only", () => {
  const rows = passportRows(bike(), { showMileage: true }, rub);
  assert.deepEqual(
    rows.map((row) => [row.key, row.label, plain(row.value)]),
    [
      ["type", "Тип", "Trekking"],
      ["use", "Назначение", "Commuting, Touring"],
      ["model", "Бренд / модель", "Cube Travel SL"],
      ["year", "Модельный год", "2020"],
      ["size", "Размер рамы", "L"],
      ["color", "Цвет", "Графит"],
      ["weight", "Вес", "14,5 кг"],
      ["status", "Статус", "Текущий"],
      ["mileage", "Пробег", "4 200 км"],
      ["price", "Стоимость велосипеда", "95 000 ₽"],
    ].map(([key, label, value]) => [key, label, value]),
  );
  // Empty, zero and hidden facts are not rows.
  const sparse = passportRows(
    bike({
      size: "",
      color: "",
      weight: 0,
      year: null,
      show_bike_price: false,
      is_former: true,
    }),
    { showMileage: false },
    rub,
  ).map((row) => row.key);
  assert.deepEqual(sparse, ["type", "use", "model", "status"]);
  assert.equal(
    passportRows(bike({ is_former: true }), {}, rub).find(
      (row) => row.key === "status",
    ).value,
    "Бывший",
  );
  // The build is not repeated in the passport.
  const text = JSON.stringify(
    passportRows(
      bike({ components: [part("build", "Тормоза", "Shimano XT")] }),
      { showMileage: true },
      rub,
    ),
  );
  assert.ok(!text.includes("Shimano"));
});

test("settings keep deciding which passport facts are public", () => {
  const keys = (options, extra) =>
    passportRows(bike(extra), options, rub).map((row) => row.key);
  assert.ok(!keys({ summaryFields: { price: false } }).includes("price"));
  assert.ok(!keys({}, { show_bike_price: false }).includes("price"));
  assert.ok(!keys({ showMileage: false }).includes("mileage"));
  assert.ok(keys({ showMileage: true }).includes("mileage"));
  // «Metadata off» hides the general facts, not a price made public.
  assert.deepEqual(keys({ summaryFields: { metadata: false } }), ["price"]);
  assert.deepEqual(
    keys({ summaryFields: { metadata: false, price: false } }),
    [],
  );
});

test("the overview draws a panel only when it has something to show", () => {
  const panels = (options, extra) => overviewPanels(bike(extra), options, rub);
  const full = panels({ summaryFields: {} });
  assert.equal(full.about, true);
  assert.equal(full.passport, true);
  assert.equal(full.manufacturerUrl, "https://www.cube.eu/");
  assert.equal(panels({ summaryFields: { description: false } }).about, false);
  assert.equal(
    panels({ summaryFields: { manufacturer: false } }).manufacturerUrl,
    null,
  );
  // Everything off: nothing for the menu to point at.
  const off = panels(
    {
      summaryFields: {
        description: false,
        manufacturer: false,
        metadata: false,
        price: false,
      },
    },
    { manufacturer_url: "" },
  );
  assert.equal(off.about, false);
  assert.equal(off.passport, false);
  // The link alone keeps the passport.
  assert.equal(
    panels(
      { summaryFields: { metadata: false, price: false } },
      { manufacturer_url: "https://www.cube.eu/" },
    ).passport,
    true,
  );
});

test("the subtitle is the type and the first two drivetrain parts", () => {
  const catalog = { componentGroups: defaultGroups };
  const parts = [
    part("build", "Рама", "Cube Aluminium"),
    part("build", "Ремень", "Gates CDX"),
    // A hub is a wheel part in the default groups, not a drivetrain one.
    part("build", "Задняя втулка", "Shimano Alfine 11"),
    part("build", "Система / шатуны", "FSA Omega"),
    part("build", "Педали", "Wellgo"),
    part("accessories", "Цепь", "Spare chain"),
  ];
  assert.equal(
    bikeSubtitle(bike({ components: parts }), catalog),
    "Trekking · Gates CDX · FSA Omega",
  );
  // Accessories are not part of the line; no drivetrain leaves the type.
  assert.equal(
    bikeSubtitle(
      bike({
        components: [
          part("build", "Рама", "Cube Aluminium"),
          part("accessories", "Цепь", "Spare chain"),
        ],
      }),
      catalog,
    ),
    "Trekking",
  );
  // The owner's order of groups does not change which parts lead.
  assert.equal(
    bikeSubtitle(
      bike({ components: parts, group_order: ["wheels", "drivetrain"] }),
      catalog,
    ),
    "Trekking · Gates CDX · FSA Omega",
  );
  // Without a type there is no line to build on, only the parts.
  assert.equal(
    bikeSubtitle(
      bike({ classification: null, category: "", components: parts }),
      catalog,
    ),
    "Gates CDX · FSA Omega",
  );
});
