import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// The private area of "rides near me" (#343) in a real browser: off by default,
// a consent of its own, the area the phone confirmed shown with its term and
// removable, and the whole thing forgotten on request. The map picker needs the
// site's raster map; what is checked here is the block, the states and the
// words, through the same settings object the app reads.
async function member(request, name) {
  const email = randomUUID() + "@example.test";
  expect(
    (
      await registerVerified(request, {
        headers: { origin },
        data: {
          ...testConsents,
          name,
          email,
          password: "nearby-secret-123",
        },
      })
    ).status(),
  ).toBe(201);
  return (await (await request.get("/api/me")).json()).user;
}
const read = async (request) => (await request.get("/api/v1/me/nearby")).json();

test("account: the area is off by default, switched on by the person, shown with its term, removed and forgotten", async ({
  page,
}) => {
  await member(page.request, "Nearby owner");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/account?tab=account");
  const nearby = page.getByRole("group", { name: "Поездки рядом" });
  await expect(nearby).toBeVisible();
  const toggle = nearby.getByLabel("Показывать новые поездки рядом", {
    exact: false,
  });
  await expect(toggle).not.toBeChecked();
  await expect(nearby.getByText("Района нет.", { exact: false })).toBeVisible();
  expect((await read(page.request)).enabled).toBe(false);

  // The switch is the person's, reachable and operable by keyboard.
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(nearby.getByRole("status").last()).toContainText(
    "Поиск поездок рядом включён",
  );
  expect((await read(page.request)).enabled).toBe(true);
  await page.reload();
  await expect(toggle).toBeChecked();

  // A hand-picked district (as the map would send it), shown after a reload.
  const before = await page.request.get("/api/v1/me/nearby");
  const put = await page.request.put("/api/v1/me/nearby/area", {
    headers: { origin, "If-Match": before.headers()["etag"] },
    data: {
      source: "manual",
      center: [37.6173, 55.7558],
      radiusM: 15000,
      label: "Сокольники",
    },
  });
  expect(put.status()).toBe(200);
  await page.reload();
  await expect(
    nearby.getByText("выбран вами вручную", { exact: false }),
  ).toBeVisible();
  await expect(nearby.getByText("«Сокольники», радиус 15 км")).toBeVisible();

  // The horizon.
  await nearby.getByLabel("Искать поездки на ближайшие").selectOption("30");
  await expect(nearby.getByRole("status").last()).toContainText(
    "Срок поиска сохранён",
  );
  expect((await read(page.request)).horizonDays).toBe(30);

  for (const color of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      color,
    );
    await expect
      .poll(
        async () =>
          (await new AxeBuilder({ page }).include("main").analyze()).violations,
      )
      .toEqual([]);
  }

  // Removing the area keeps the person's choices.
  await nearby.getByRole("button", { name: "Удалить район" }).click();
  await expect(nearby.getByText("Района нет.", { exact: false })).toBeVisible();
  const kept = await read(page.request);
  expect(kept.area).toBeNull();
  expect(kept.enabled).toBe(true);
  expect(kept.horizonDays).toBe(30);

  // Forgetting everything.
  await nearby.getByRole("button", { name: "Забыть всё и отказаться" }).click();
  await expect(nearby.getByRole("status").last()).toContainText(
    "Район и настройки удалены",
  );
  await expect(toggle).not.toBeChecked();
  const forgotten = await read(page.request);
  expect(forgotten.enabled).toBe(false);
  expect(forgotten.horizonDays).toBe(14);
});

// The grid of lib/nearby.ts, as a phone computes it before it sends anything.
const cellCenter = (value, step) =>
  Number(((Math.floor(value / step + 1e-9) + 0.5) * step).toFixed(5));

test("account: an area confirmed by the phone shows its term", async ({
  page,
  playwright,
}) => {
  const me = await member(page.request, "Nearby phone");
  // The phone's area is written with the token of the app, as the app does.
  const app = await playwright.request.newContext({ baseURL: origin });
  try {
    const grant = await app.post("/api/v1/auth/sessions", {
      data: {
        email: me.email,
        password: "nearby-secret-123",
        device: { name: "Телефон", platform: "android" },
      },
    });
    expect(grant.status()).toBe(201);
    const authorization = "Bearer " + (await grant.json()).accessToken;
    const state = await app.get("/api/v1/me/nearby", {
      headers: { authorization },
    });
    const saved = await app.put("/api/v1/me/nearby/area", {
      headers: { authorization, "If-Match": state.headers()["etag"] },
      data: {
        source: "device",
        center: [cellCenter(37.6173, 0.05), cellCenter(55.7558, 0.03)],
        radiusM: 10000,
      },
    });
    expect(saved.status()).toBe(200);
  } finally {
    await app.dispose();
  }
  await page.goto("/account?tab=account");
  const nearby = page.getByRole("group", { name: "Поездки рядом" });
  await expect(nearby).toBeVisible();
  await expect(
    nearby.getByText("подтверждён телефоном и действует до", { exact: false }),
  ).toBeVisible();
  await expect(
    nearby.getByText("радиус 10 км", { exact: false }),
  ).toBeVisible();
  // A hand-picked district would replace it: the page does not do that unasked.
  await expect(
    nearby.getByRole("button", { name: "Сохранить район" }),
  ).toBeDisabled();
});
