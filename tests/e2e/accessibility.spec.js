import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow, describeOverflow } from "../fixtures/overflow.js";
import { gpx, loop } from "../ride-fixtures.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #119: axe on the main pages in both themes, WCAG 2.1 A and AA, plus the
// experimental label-content-name-mismatch: a control's visible text must
// be part of its accessible name. The desktop project runs axe at 1440 and
// 390 px, the phone project on its own screen. On a phone, navigation
// buttons and links are at least 44×44 px.
// #127: the same pages at 1440, 768, 390 and 360 px keep to the screen
// width (no horizontal scroll, WCAG 1.4.10), and each one is saved as a
// full-page screenshot: test-results, the browser-review artifact in CI.
const axeOptions = {
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
  },
  rules: { "label-content-name-mismatch": { enabled: true } },
};
const phoneWidth = 390;
const desktopWidths = [1440, 768, phoneWidth, 360];
const axeWidths = [1440, phoneWidth];
const navigationTargets =
  "header a, header button, nav a, nav button, footer a, footer button";

// One line per failing element: page, theme and width, the rule, the
// element and what to fix.
function describe(where, violations) {
  return violations.flatMap((v) =>
    v.nodes.map(
      (node) =>
        `${where} — ${v.id} (${v.impact}): ${v.help}\n` +
        `    элемент: ${node.target.join(" ")}\n` +
        `    ${node.html.slice(0, 200)}\n` +
        `    ${(node.failureSummary || "").replace(/\n/g, "\n    ")}`,
    ),
  );
}

// Visible navigation targets smaller than 44×44 px.
function smallTargets(page) {
  return page.evaluate((selector) => {
    const small = [];
    for (const element of document.querySelectorAll(selector)) {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      if (getComputedStyle(element).visibility === "hidden") continue;
      if (box.width >= 43.5 && box.height >= 43.5) continue;
      const name = (element.getAttribute("aria-label") || element.textContent)
        .replace(/\s+/g, " ")
        .trim();
      small.push(
        `${element.tagName.toLowerCase()} «${name.slice(0, 40)}» ` +
          `${Math.round(box.width)}×${Math.round(box.height)}`,
      );
    }
    return small;
  }, navigationTargets);
}

test("main pages pass axe in both themes", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(600000);
  const nonce = randomUUID().slice(0, 8);
  // The data comes from an API context: the browser stays a guest.
  const api = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { origin },
  });
  const post = async (path, data) => {
    const r = await api.post("/api/" + path, { data });
    expect(r.ok(), path + " " + r.status()).toBe(true);
    return r.json();
  };
  const email = `a11y-${nonce}@example.test`,
    password = "a11y-check-secret-123";
  await post("auth/register", {
    ...testConsents,
    name: "Доступность " + nonce,
    email,
    password,
  });
  const { username } = (await (await api.get("/api/me")).json()).user;
  const created = await post("bikes", {
    name: "Гравел " + nonce,
    brand: "Cube",
    model: "Nuroad",
    year: 2024,
    category: "gravel",
    description: "Для длинных выходных " + nonce,
    color: "",
    size: "",
    weight: 9.4,
    is_public: true,
  });
  const { bike } = await (await api.get("/api/bikes/" + created.id)).json();
  await post(`bikes/${bike.id}/components`, {
    section: "build",
    category: "Групсет",
    name: "Shimano GRX " + nonce,
    notes: "",
    price: null,
  });
  const entry = await post("journal", {
    bikeId: bike.id,
    kind: "service",
    title: "Сервис " + nonce,
    body: "Заменил тормозные колодки " + nonce,
    status: "published",
    isPublic: true,
  });
  const preview = await post("rides/preview", gpx([loop]));
  const ride = await post("rides", {
    previewId: preview.previewId,
    bikeId: bike.id,
    title: "Круг " + nonce,
    description: "Вдоль реки " + nonce,
    isPublic: true,
    privacyEnabled: false,
    privacyRadiusM: 500,
  });
  const listing = await post("market", {
    title: "Колёса " + nonce,
    description: "Пара колёс " + nonce,
    category: "components",
    listingType: "sale",
    condition: "used",
    price: 9000,
    currency: "RUB",
    location: "Казань",
    contact: "",
    status: "active",
  });
  await api.dispose();

  // [label in the report, path, screenshot name]
  const guestPages = [
    ["главная", "/", "home"],
    ["витрина", "/bikes", "bikes"],
    ["велосипед", "/b/" + bike.share_id, "bike"],
    ["запись", "/j/" + entry.shareId, "entry"],
    ["покатушка", "/r/" + ride.shareId, "ride"],
    ["объявление", "/market/" + listing.shareId, "listing"],
    ["профиль", "/@" + username, "profile"],
    ["о проекте", "/about", "about"],
    ["вход", "/login", "login"],
  ];
  // The owner sees the editing controls.
  const ownerPages = [
    ["велосипед владельца", "/b/" + bike.share_id, "bike-owner"],
    ["кабинет", "/account", "account"],
  ];
  const phone = !!info.project.use.isMobile;
  const widths = phone ? [page.viewportSize().width] : desktopWidths;
  const problems = [];
  let mismatchRuleRan = false;
  async function check([label, path, name], theme) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() => document.fonts.ready);
    const width = page.viewportSize().width;
    const where = `${label} ${path} · ${theme === "dark" ? "тёмная" : "светлая"} тема · ${width} px`;
    const overflow = await pageOverflow(page);
    if (overflow) problems.push(`${where} — ${describeOverflow(overflow)}`);
    if (phone || axeWidths.includes(width)) {
      const results = await new AxeBuilder({ page })
        .options(axeOptions)
        .analyze();
      mismatchRuleRan ||= [
        ...results.passes,
        ...results.violations,
        ...results.incomplete,
        ...results.inapplicable,
      ].some((rule) => rule.id === "label-content-name-mismatch");
      problems.push(...describe(where, results.violations));
    }
    if (width <= phoneWidth)
      for (const target of await smallTargets(page))
        problems.push(`${where} — цель нажатия меньше 44×44: ${target}`);
    await page.screenshot({
      path: info.outputPath(`${name}-${theme}-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  async function checkAll(list) {
    for (const theme of ["light", "dark"]) {
      // The theme a visitor picked lives in localStorage and is applied
      // before the first paint.
      await page.evaluate(
        (value) => localStorage.setItem("cola:theme", value),
        theme,
      );
      for (const width of widths) {
        if (!phone)
          await page.setViewportSize({
            width,
            height: width > phoneWidth ? 900 : 844,
          });
        for (const item of list) await check(item, theme);
      }
    }
  }

  await page.goto("/about");
  await checkAll(guestPages);
  expect(
    (
      await page.request.post("/api/auth/login", {
        headers: { origin },
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
  await checkAll(ownerPages);

  expect(mismatchRuleRan, "label-content-name-mismatch did not run").toBe(true);
  expect(problems, "\n" + problems.join("\n\n")).toEqual([]);
});
