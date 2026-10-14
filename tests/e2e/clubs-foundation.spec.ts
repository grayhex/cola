import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import AxeBuilder from "@axe-core/playwright";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
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
  await page
    .getByRole("button", {
      name: /^(Создать клуб|Сохранить изменения)$/,
      exact: true,
    })
    .click();
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
  await page
    .getByRole("button", {
      name: /^(Создать клуб|Сохранить изменения)$/,
      exact: true,
    })
    .click();
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
  await page
    .getByRole("button", {
      name: /^(Создать клуб|Сохранить изменения)$/,
      exact: true,
    })
    .click();
  await expect(page.locator("p[role=alert]")).toHaveText(
    "Логотип: Тестовый отказ загрузки",
  );
  await expect(
    page.getByRole("textbox", { name: "Название", exact: true }),
  ).toHaveValue("Без дубля после потери сети");
  await page
    .getByRole("button", {
      name: /^(Создать клуб|Сохранить изменения)$/,
      exact: true,
    })
    .click();
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

test("club UI: URL filters, mobile disclosure, measured fields and management surfaces", async ({
  page,
  browserName,
}, info) => {
  if (process.env.CLUB_UI_DESIGN_REPORTS) test.setTimeout(180000);
  await owner(page.request);
  const c = await newClub(page.request);
  await page.goto("/clubs");
  const form = page.locator("form").filter({
    has: page.getByRole("searchbox", { name: "Поиск", exact: true }),
  });
  await form.getByRole("searchbox").fill(c.name);
  await form.getByRole("searchbox").press("Enter");
  await expect(page).toHaveURL(/q=/);
  await expect(page.locator('a[href="/clubs/' + c.id + '"]')).toBeVisible();
  await page.reload();
  await expect(form.getByRole("searchbox")).toHaveValue(c.name);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Фильтры/ }).click();
  const dialog = page.getByRole("dialog", { name: "Фильтры клубов" });
  await dialog
    .getByLabel("Город", { exact: true })
    .fill("Не применённый город");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Фильтры/ })).toBeFocused();
  await form.getByRole("searchbox").press("Enter");
  await expect(page).not.toHaveURL(/city=/);
  await page.getByRole("button", { name: /^Фильтры/ }).click();
  await dialog
    .getByLabel("Город", { exact: true })
    .fill("Несуществующий город");
  await dialog.getByRole("button", { name: "Применить" }).click();
  await expect(page).toHaveURL(/city=/);
  await expect(
    page.getByRole("heading", { name: "Ничего не найдено" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Сбросить", exact: true }).click();
  await expect(page).toHaveURL(origin + "/clubs");
  const widths =
    browserName === "chromium"
      ? [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920]
      : [390, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width >= 768 ? 900 : 844 });
    for (const t of ["light", "dark"]) {
      await theme(page, t);
      await expect(
        page.getByRole("searchbox", { name: "Поиск" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      const gap = await page
        .getByRole("searchbox", { name: "Поиск" })
        .evaluate((el) => {
          const label = el.closest("label")!;
          return parseFloat(getComputedStyle(label).rowGap);
        });
      expect(gap).toBeGreaterThanOrEqual(4);
      if (width === 390 || width === 1440)
        await page.screenshot({
          path: info.outputPath(`catalog-${width}-${t}.png`),
          fullPage: true,
        });
    }
  }
  await page.goto("/clubs/" + c.id + "?tab=members");
  await expect(
    page
      .getByRole("navigation", { name: "Разделы клуба" })
      .getByRole("link", { name: "Участники" }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto("/clubs/" + c.id + "/manage?section=members");
  await expect(
    page.getByRole("heading", { name: "Участники и заявки" }),
  ).toBeVisible();
  const invite = page.getByRole("textbox", {
    name: "Пригласить по имени пользователя",
  });
  expect(
    await invite.evaluate((el) =>
      parseFloat(getComputedStyle(el.closest("label")!).rowGap),
    ),
  ).toBeGreaterThanOrEqual(4);
  for (const width of [390, 1440]) {
    for (const t of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await theme(page, t);
      await page.screenshot({
        path: info.outputPath(`management-${width}-${t}.png`),
        fullPage: true,
      });
    }
  }
  const inputBox = await invite.boundingBox();
  const inviteButtonBox = await page
    .getByRole("button", { name: "Пригласить", exact: true })
    .boundingBox();
  expect(inputBox).not.toBeNull();
  expect(inviteButtonBox).not.toBeNull();
  expect(
    Math.abs(
      inputBox!.y +
        inputBox!.height -
        inviteButtonBox!.y -
        inviteButtonBox!.height,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    inviteButtonBox!.x - inputBox!.x - inputBox!.width,
  ).toBeGreaterThanOrEqual(8);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.goto("/clubs/new");
  for (const width of [390, 1440]) {
    for (const t of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await theme(page, t);
      await expect(
        page.getByRole("textbox", { name: "Название", exact: true }),
      ).toBeEnabled();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await expect(page.locator('[contenteditable="true"]')).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`editor-${width}-${t}.png`),
        fullPage: true,
      });
    }
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  if (process.env.CLUB_UI_DESIGN_REPORTS) {
    for (const [surface, path] of [
      ["catalog", "/clubs"],
      ["club", "/clubs/" + c.id],
    ])
      for (const viewport of ["390x844", "1440x900"]) {
        const report = spawnSync(
          process.execPath,
          [
            "tools/design-qa/impeccable.mjs",
            "detect",
            "--json",
            "--viewport",
            viewport,
            origin + path,
          ],
          { encoding: "utf8", timeout: 30000 },
        );
        const base = join(
          process.env.CLUB_UI_DESIGN_REPORTS,
          `rendered-${surface}-${viewport}`,
        );
        writeFileSync(base + ".json", report.stdout || "");
        writeFileSync(
          base + ".stderr",
          report.stderr || String(report.error || ""),
        );
        writeFileSync(base + ".exit", String(report.status));
        expect([0, 2], report.stderr || String(report.error || "")).toContain(
          report.status,
        );
      }
  }
  await page
    .getByRole("textbox", { name: "Название", exact: true })
    .fill("Черновик для отмены");
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /Продолжить|Остаться/ })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Название", exact: true }),
  ).toHaveValue("Черновик для отмены");
});
