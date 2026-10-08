import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
import { randomUUID } from "node:crypto";
import { gpx, loop } from "../ride-fixtures.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #366: the bike page is a set of real tabs under a shared header. Direct
// links, reload, Back and Forward, the counters of the header and the
// keyboard all open the same panel; a panel keeps what was typed in it.
const tabNames = [
  ["overview", "Обзор"],
  ["specifications", "Комплектация"],
  ["bike-rides", "Покатушки"],
  ["journal", "Записи"],
  ["discussion", "Комментарии"],
];
async function owner(page, label) {
  const suffix = randomUUID();
  const registered = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: label + " " + suffix.slice(0, 6),
      email: suffix + "@example.test",
      password: "bike-tabs-secret-123",
    },
  });
  expect(registered.status()).toBe(201);
  const post = async (path, data) => {
    const response = await page.request.post("/api/" + path, {
      headers: { origin },
      data,
    });
    expect(response.ok(), path + " " + (await response.text())).toBe(true);
    return response.json();
  };
  return post;
}
async function publicBike(post, page, patch = {}) {
  const created = await post("bikes", {
    name: "Вкладки · велосипед",
    brand: "Cube",
    model: "Nuroad",
    year: 2024,
    category: "gravel",
    description: "Гравийник для долгих поездок.\n\nЧто-то про заметки.",
    color: "",
    size: "",
    weight: 9.8,
    is_public: true,
    ...patch,
  });
  for (const [category, name] of [
    ["Рама", "Cube Nuroad Race"],
    ["Тормоза", "Shimano GRX"],
  ])
    await post(`bikes/${created.id}/components`, {
      section: "build",
      category,
      name,
      price: null,
      notes: "",
    });
  const preview = await post("rides/preview", gpx([loop]));
  await post("rides", {
    previewId: preview.previewId,
    bikeId: created.id,
    title: "Круг по набережной",
    description: "",
    isPublic: patch.is_public !== false,
    privacyEnabled: false,
    privacyRadiusM: 500,
  });
  await post("journal", {
    bikeId: created.id,
    kind: "service",
    title: "Заменил цепь",
    body: "Поменял цепь и кассету после зимы.",
    status: "published",
    isPublic: true,
  });
  const { bike } = await (
    await page.request.get("/api/bikes/" + created.id)
  ).json();
  return { id: created.id, path: "/b/" + bike.share_id };
}
const tabs = (page) =>
  page.getByRole("tablist", { name: "Разделы велосипеда" });
const tab = (page, name) => tabs(page).getByRole("tab", { name, exact: true });
const visiblePanels = (page) => page.locator(".bike-tabpanel:not([hidden])");

test("bike tabs: semantics, one panel at a time, direct links, reload, Back and Forward", async ({
  page,
  browser,
}, info) => {
  const post = await owner(page, "Tabs");
  const bike = await publicBike(post, page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const guest = await browser.newContext(info.project.use);
  const reader = await guest.newPage();
  try {
    for (const [who, view] of [
      ["owner", page],
      ["guest", reader],
    ]) {
      await view.goto(bike.path);
      // Five tabs in the tablist; the overview is open, and only it.
      await expect(tabs(view).getByRole("tab")).toHaveText(
        tabNames.map(([, name]) => name),
      );
      await expect(tab(view, "Обзор")).toHaveAttribute("aria-selected", "true");
      await expect(visiblePanels(view)).toHaveCount(1);
      for (const [id, name] of tabNames) {
        const controls = await tab(view, name).getAttribute("aria-controls");
        const panel = view.locator("#" + controls);
        await expect(panel).toHaveAttribute("role", "tabpanel");
        await expect(panel).toHaveAttribute(
          "aria-labelledby",
          (await tab(view, name).getAttribute("id")) ?? "",
        );
        await expect(panel).toHaveAttribute("data-tab-panel", id);
        if (id !== "overview") await expect(panel).toBeHidden();
      }
      // The shared header stays above every tab.
      for (const [, name] of tabNames) {
        await tab(view, name).click();
        await expect(tab(view, name)).toHaveAttribute("aria-selected", "true");
        await expect(visiblePanels(view)).toHaveCount(1);
        await expect(view.locator(".bike-identity h1")).toBeVisible();
        await expect(
          view.locator(".photo-stage, .gallery").first(),
        ).toBeVisible();
      }

      // Every tab has a direct link, which survives a reload and stays as
      // it is in the address.
      for (const [id, name] of tabNames) {
        await view.goto(bike.path + "#" + id);
        await expect(tab(view, name)).toHaveAttribute("aria-selected", "true");
        await expect(view.locator("#bike-panel-" + id)).toBeVisible();
        await expect(visiblePanels(view)).toHaveCount(1);
        await view.reload();
        await expect(tab(view, name)).toHaveAttribute("aria-selected", "true");
        await expect(view).toHaveURL(new RegExp("#" + id + "$"));
      }
      // A link to a comment opens the comments, with or without the hash.
      await view.goto(bike.path + "?comment=" + randomUUID());
      await expect(tab(view, "Комментарии")).toHaveAttribute(
        "aria-selected",
        "true",
      );

      // A link to a comment of the discussion (the parent link of a reply)
      // opens the comments on a fresh load too, before the lazy discussion
      // has drawn the comment the address names.
      await view.goto(bike.path + "#comment-" + randomUUID());
      await expect(tab(view, "Комментарии")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(view).toHaveURL(/#comment-/);

      // A tab click is a step in the history: Back and Forward follow it,
      // and nothing else adds an entry.
      await view.goto(bike.path);
      const entries = await view.evaluate(() => history.length);
      await tab(view, "Комплектация").click();
      await tab(view, "Покатушки").click();
      await tab(view, "Покатушки").click();
      expect(await view.evaluate(() => history.length)).toBe(entries + 2);
      await expect(view).toHaveURL(/#bike-rides$/);
      await view.goBack();
      await expect(view).toHaveURL(/#specifications$/);
      await expect(tab(view, "Комплектация")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(view.locator("#specifications")).toBeVisible();
      await view.goBack();
      await expect(tab(view, "Обзор")).toHaveAttribute("aria-selected", "true");
      await view.goForward();
      await view.goForward();
      await expect(tab(view, "Покатушки")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      // The address edited by hand opens a tab, a name that is no tab opens
      // the first one and is left alone.
      await view.evaluate(() => (location.hash = "#journal"));
      await expect(tab(view, "Записи")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await view.evaluate(() => (location.hash = "#nothing-here"));
      await expect(tab(view, "Обзор")).toHaveAttribute("aria-selected", "true");
      await expect(view).toHaveURL(/#nothing-here$/);
      expect(who).toBeTruthy();
    }
  } finally {
    await guest.close();
  }
});

test("bike tabs: the counters and links in the header open their panels and keep their numbers", async ({
  page,
}) => {
  const post = await owner(page, "Counters");
  const bike = await publicBike(post, page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bike.path);
  const metrics = page.locator(".bike-metrics");
  // The numbers are there before any tab is opened.
  const count = (label) =>
    metrics.locator("li", { hasText: label }).locator("strong");
  await expect(count("Покатушек")).toHaveText("1");
  await expect(count("Деталей")).toHaveText("2");
  await expect(count("Комментарии")).toHaveText("0");

  await metrics.getByRole("link", { name: /Комментарии/ }).click();
  await expect(tab(page, "Комментарии")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#discussion")).toBeVisible();
  await expect(page).toHaveURL(/#discussion$/);
  await expect(page.locator(".bike-tabs")).toBeInViewport();
  await metrics.getByRole("link", { name: /Покатушек/ }).click();
  await expect(tab(page, "Покатушки")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#bike-rides")).toBeVisible();
  await metrics.getByRole("link", { name: /Деталей/ }).click();
  await expect(tab(page, "Комплектация")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#specifications")).toBeVisible();
  // The quote's link goes to the overview.
  await page.locator(".bike-quote").getByRole("link").click();
  await expect(tab(page, "Обзор")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#overview")).toBeVisible();
  // The numbers did not change on the way.
  await expect(count("Покатушек")).toHaveText("1");
  await expect(count("Деталей")).toHaveText("2");
  // The awards are in the overview.
  await expect(page.locator("#bike-panel-overview .bike-game")).toBeVisible();
  await expect(page.locator(".bike-game")).toHaveCount(1);
});

test("bike tabs: keyboard, a single stop in the list, hidden panels out of reach", async ({
  page,
}) => {
  const post = await owner(page, "Keys");
  const bike = await publicBike(post, page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bike.path);
  await tab(page, "Обзор").focus();
  // One stop: the other tabs are not in the order of Tab.
  for (const [, name] of tabNames.slice(1))
    await expect(tab(page, name)).toHaveAttribute("tabindex", "-1");
  await expect(tab(page, "Обзор")).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Комплектация")).toBeFocused();
  await expect(tab(page, "Комплектация")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#specifications")).toBeVisible();
  await page.keyboard.press("End");
  await expect(tab(page, "Комментарии")).toBeFocused();
  await expect(tab(page, "Комментарии")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Обзор")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab(page, "Комментарии")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab(page, "Обзор")).toBeFocused();
  await expect(tab(page, "Обзор")).toHaveAttribute("aria-selected", "true");
  // The focus ring is visible.
  const ring = await tab(page, "Обзор").evaluate((el) => {
    const style = getComputedStyle(el);
    return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
  });
  expect(ring).toBe(true);
  // Tab leaves the list for the open panel only: nothing in a hidden panel
  // can take the focus.
  const reachable = await page.evaluate(() => {
    const hidden = [...document.querySelectorAll(".bike-tabpanel[hidden]")];
    return hidden.some((panel) => panel.offsetParent !== null);
  });
  expect(reachable).toBe(false);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest(".bike-tabpanel[hidden]"),
      ),
    ).toBe(false);
  }
});

test("bike tabs: what is typed in a panel is kept, and the page does not grow with the hidden ones", async ({
  page,
}) => {
  const post = await owner(page, "Keep");
  const bike = await publicBike(post, page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bike.path);
  await tab(page, "Комментарии").click();
  const draft = page.getByRole("textbox", {
    name: "Ваш комментарий",
    exact: true,
  });
  await draft.fill("Черновик комментария, который нельзя потерять");
  await tab(page, "Записи").click();
  await expect(page.locator("#journal")).toBeVisible();
  await tab(page, "Комментарии").click();
  // The editor is rich text: its content, not an input value.
  await expect(draft).toContainText(
    "Черновик комментария, который нельзя потерять",
  );
  // Only the open panel takes room: the hidden ones are not drawn at all,
  // so the page is as long as one tab, not the five of them.
  await tab(page, "Обзор").click();
  const parts = await page.evaluate(() =>
    [...document.querySelectorAll(".bike-tabpanel")].map((panel) =>
      Math.round(panel.getBoundingClientRect().height),
    ),
  );
  expect(parts).toHaveLength(5);
  expect(parts.filter((value) => value > 0)).toHaveLength(1);
});

test("bike tabs: a private bike has no rides or comments, a missing tab falls back and the address is kept", async ({
  page,
}) => {
  const post = await owner(page, "Private");
  const bike = await publicBike(post, page, { is_public: false });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bike.path + "#discussion");
  await expect(tabs(page).getByRole("tab")).toHaveText([
    "Обзор",
    "Комплектация",
    "Записи",
  ]);
  await expect(tab(page, "Обзор")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/#discussion$/);
  await expect(page.locator("#discussion")).toHaveCount(0);
  // The tabs that are there still work; a name that is no tab opens the first.
  await page.goto(bike.path + "#journal");
  await expect(tab(page, "Записи")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#journal")).toBeVisible();
  // Made public, the same link opens the comments.
  expect(
    (
      await page.request.patch("/api/bikes/" + bike.id, {
        headers: { origin },
        data: { is_public: true },
      })
    ).status(),
  ).toBeLessThan(300);
  await page.goto(bike.path + "#discussion");
  await expect(tab(page, "Комментарии")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("bike tabs on a phone: the row scrolls inside itself, the page does not, in both themes", async ({
  page,
}, info) => {
  const post = await owner(page, "Phone");
  const bike = await publicBike(post, page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bike.path);
  expect(await pageOverflow(page)).toBeNull();
  const row = page.locator(".bike-tabs");
  const scrolls = await row.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scrolls).toBe(true);
  // The last tab is brought into view in the row when it opens.
  await tab(page, "Комментарии").click();
  const inside = await page.evaluate(() => {
    const rowBox = document.querySelector(".bike-tabs").getBoundingClientRect();
    const box = document
      .querySelector('.bike-tabs [aria-selected="true"]')
      .getBoundingClientRect();
    return box.left >= rowBox.left - 1 && box.right <= rowBox.right + 1;
  });
  expect(inside).toBe(true);
  expect(await pageOverflow(page)).toBeNull();
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.screenshot({
      path: info.outputPath(`bike-tabs-phone-${colorScheme}.png`),
      animations: "disabled",
    });
    expect(
      (await new AxeBuilder({ page }).include(".bike-tabs").analyze())
        .violations,
    ).toEqual([]);
  }
});
