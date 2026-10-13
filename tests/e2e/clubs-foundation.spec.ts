import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import type { ClubDto } from "../../lib/club-contracts.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100",
  headers = { origin };
async function owner(request: APIRequestContext) {
  const email = randomUUID() + "@example.test";
  const r = await registerVerified(request, {
    headers,
    data: {
      ...testConsents,
      name: "Клубный участник",
      email,
      password: "club-fixture-413",
    },
  });
  expect(r.status()).toBe(201);
  const b = await request.post("/api/bikes", {
    headers,
    data: {
      name: "Приватный велосипед клуба",
      brand: "Cube",
      model: "Nuroad",
      year: 2026,
      category: "gravel",
      is_public: false,
      description: "",
      color: "",
      size: "",
      weight: null,
    },
  });
  expect(b.status(), await b.text()).toBe(201);
}
const details = (name = "Гравийные поездки по выходным") => ({
  name,
  slogan: "Ездим вместе",
  city: "",
  formats: ["гравий"],
  mission: "Вместе знакомимся с дорогами.",
  joinMode: "application",
  membersVisibility: "members",
});
async function newClub(request: APIRequestContext) {
  const r = await request.post("/api/clubs", {
    headers,
    data: { ...details(), requestId: randomUUID() },
  });
  expect(r.status(), await r.text()).toBe(201);
  const result: { club: ClubDto } = await r.json();
  return result.club;
}
async function theme(page: Page, value: string) {
  await page.evaluate((v) => localStorage.setItem("cola:theme", v), value);
  await page.reload();
}

test("club HTTP: real concurrent quota, same-origin, idempotency, versions and public ACL", async ({
  page,
  browser,
}) => {
  await owner(page.request);
  const attempts = await Promise.all(
    Array.from({ length: 4 }, () =>
      page.request.post("/api/clubs", {
        headers,
        data: { ...details(), requestId: randomUUID() },
      }),
    ),
  );
  expect(attempts.filter((r) => r.status() === 201)).toHaveLength(3);
  expect(attempts.filter((r) => r.status() === 409)).toHaveLength(1);
  const created: { club: ClubDto } = await attempts
      .find((r) => r.status() === 201)!
      .json(),
    club = created.club;
  const refused = await page.request.patch("/api/clubs/" + club.id, {
    data: { ...details(), version: club.version },
  });
  expect(refused.status()).toBe(403);
  const rules = await page.request.patch("/api/clubs/" + club.id + "/rules", {
    headers,
    data: {
      body: "## Наши правила\nЕдем вместе и не оставляем мусор.",
      version: club.version,
    },
  });
  expect(rules.status()).toBe(200);
  const stale = await page.request.patch("/api/clubs/" + club.id, {
    headers,
    data: { ...details("Устаревшее имя"), version: club.version },
  });
  expect(stale.status()).toBe(409);
  const current: { club: ClubDto } = await rules.json();
  const outsider = await browser.newContext();
  await owner(outsider.request);
  expect(
    (
      await outsider.request.patch("/api/clubs/" + club.id + "/rules", {
        headers,
        data: { body: "Чужая правка", version: current.club.version },
      })
    ).status(),
  ).toBe(403);
  const guest = await browser.newContext();
  const pub = await guest.request.get("/api/clubs/" + club.id);
  expect(pub.status()).toBe(200);
  const payload: { club: ClubDto } = await pub.json();
  expect(payload.club.membership).toBeNull();
  expect(payload.club.canManage).toBe(false);
  expect(JSON.stringify(payload)).not.toContain("@example.test");
  await guest.close();
  await outsider.close();
  const archived = await page.request.patch(
    "/api/clubs/" + club.id + "/archive",
    { headers, data: { archived: true, version: current.club.version } },
  );
  expect(archived.status()).toBe(200);
  const old: { club: ClubDto } = await archived.json();
  const key = randomUUID();
  const first = await page.request.post("/api/clubs", {
    headers,
    data: { ...details(), requestId: key },
  });
  expect(first.status()).toBe(201);
  const retry = await page.request.post("/api/clubs", {
    headers,
    data: { ...details(), requestId: key },
  });
  expect(retry.status()).toBe(201);
  expect((await retry.json()).club.id).toBe((await first.json()).club.id);
  const restore = await page.request.patch(
    "/api/clubs/" + club.id + "/archive",
    { headers, data: { archived: false, version: old.club.version } },
  );
  expect(restore.status()).toBe(409);
});

test("club creation: responsive themes, draft Back, safe logo/cover and rules", async ({
  page,
  browserName,
}, info) => {
  await owner(page.request);
  await page.goto("/clubs/new");
  await page
    .getByRole("textbox", { name: "Название", exact: true })
    .fill("Гравийный клуб длинных названий и добрых поездок");
  await page
    .locator('[contenteditable="true"]')
    .fill("Компания для спокойных поездок по новым дорогам.");
  await page.locator("a.brand").click();
  await expect(page).toHaveURL(origin + "/");
  await page.goBack();
  await expect(
    page.getByRole("textbox", { name: "Название", exact: true }),
  ).toHaveValue("Гравийный клуб длинных названий и добрых поездок");
  const image = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#58705a" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("Логотип", { exact: false }).setInputFiles({
    name: "club-logo.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.getByLabel("Обложка", { exact: false }).setInputFiles({
    name: "club-cover.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page).toHaveURL(/\/clubs\/[a-f0-9-]{36}$/);
  await expect(
    page.getByRole("img", { name: /Логотип Гравийный/ }),
  ).toBeVisible();
  const path = new URL(page.url()).pathname;
  for (const width of browserName === "chromium"
    ? [320, 360, 393, 430, 768, 1440]
    : [393]) {
    await page.setViewportSize({ width, height: width >= 768 ? 900 : 852 });
    for (const value of ["light", "dark"]) {
      await theme(page, value);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Гравийный клуб длинных названий и добрых поездок",
      );
      const sizes = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
      if (width < 701) {
        const box = await page
          .getByRole("link", { name: "Правила клуба", exact: true })
          .boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      await expect
        .poll(() =>
          page
            .locator('img[alt="Обложка клуба"]')
            .evaluate(
              (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
            ),
        )
        .toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.screenshot({
        path: info.outputPath("club-" + width + "-" + value + ".png"),
        fullPage: true,
      });
    }
  }
  await page.getByRole("link", { name: "Правила клуба", exact: true }).click();
  await expect(
    page.getByText("Правила пока не опубликованы.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Редактировать правила" }).click();
  await page
    .locator('[contenteditable="true"]')
    .fill("Держимся вместе, предупреждаем о препятствиях и бережём природу.");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page).toHaveURL(origin + path + "/rules");
  await expect(
    page.getByText(
      "Держимся вместе, предупреждаем о препятствиях и бережём природу.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("a failed image upload resumes the created club rather than creating twice", async ({
  page,
}) => {
  await owner(page.request);
  await page.goto("/clubs/new");
  await page
    .getByRole("textbox", { name: "Название", exact: true })
    .fill("Без дубля после потери сети");
  const image = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Логотип", { exact: false })
    .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: image });
  let creates = 0,
    uploads = 0;
  page.on("request", (r) => {
    if (r.url() === origin + "/api/clubs" && r.method() === "POST") creates++;
  });
  await page.route("**/api/clubs/*/logo?version=*", async (route) => {
    uploads++;
    if (uploads === 1)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Тестовый отказ загрузки" }),
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toHaveText(
    "Тестовый отказ загрузки",
  );
  await expect(
    page.getByRole("textbox", { name: "Название", exact: true }),
  ).toHaveValue("Без дубля после потери сети");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page).toHaveURL(/\/clubs\/[a-f0-9-]{36}$/);
  expect(creates).toBe(1);
  expect(uploads).toBe(2);
});

test("club media rejects SVG and wrong-club image IDs; replacing revokes the old URL", async ({
  page,
}) => {
  await owner(page.request);
  let club = await newClub(page.request);
  const other = await newClub(page.request);
  const svg = await page.request.put(
    "/api/clubs/" + club.id + "/logo?version=" + club.version,
    {
      headers: { ...headers, "content-type": "image/svg+xml" },
      data: '<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>',
    },
  );
  expect(svg.status()).toBe(400);
  const image = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const uploaded = await page.request.put(
    "/api/clubs/" + club.id + "/logo?version=" + club.version,
    { headers: { ...headers, "content-type": "image/png" }, data: image },
  );
  expect(uploaded.status()).toBe(200);
  const result: { club: ClubDto } = await uploaded.json();
  club = result.club;
  expect(club.logo).toBeTruthy();
  const media = club.logo!;
  const picture = await page.request.get(media);
  expect(picture.status()).toBe(200);
  expect(picture.headers()["content-type"]).toBe("image/webp");
  expect(
    (await page.request.get(media.replace(club.id, other.id))).status(),
  ).toBe(404);
  const removed = await page.request.delete(
    "/api/clubs/" + club.id + "/logo?version=" + club.version,
    { headers },
  );
  expect(removed.status()).toBe(200);
  expect((await page.request.get(media)).status()).toBe(404);
});
