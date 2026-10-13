import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import type { ClubDto } from "../../lib/club-contracts.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100",
  headers = { origin };
async function person(request: APIRequestContext, bike = true) {
  const email = randomUUID() + "@example.test";
  const response = await registerVerified(request, {
    headers,
    data: {
      ...testConsents,
      name: "Участник " + randomUUID().slice(0, 6),
      email,
      password: "club-member-fixture-413",
    },
  });
  expect(response.status()).toBe(201);
  const data: { user: { id: string; username: string } } =
    await response.json();
  let share: string | null = null;
  if (bike) {
    const r = await request.post("/api/bikes", {
      headers,
      data: {
        name: "Гравийный велосипед для клуба",
        brand: "Cube",
        model: "Nuroad",
        year: 2026,
        category: "gravel",
        is_public: true,
        description: "",
        color: "",
        size: "",
        weight: null,
      },
    });
    expect(r.status()).toBe(201);
    const created: { id: string } = await r.json();
    const read = await request.get("/api/bikes/" + created.id);
    expect(read.status()).toBe(200);
    const b: { bike: { share_id: string } } = await read.json();
    share = b.bike.share_id;
  }
  return { ...data.user, share };
}
async function club(
  request: APIRequestContext,
  name = "Клуб дальних гравийных путешествий",
  open = false,
) {
  const r = await request.post("/api/clubs", {
    headers,
    data: {
      name,
      slogan: "Вместе по новым дорогам",
      mission: "Знакомимся и ездим вместе.",
      requestId: randomUUID(),
      joinMode: open ? "open" : "application",
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  const result: { club: ClubDto } = await r.json();
  return result.club;
}
async function chooseTheme(page: Page, value: string) {
  await page.evaluate((v) => localStorage.setItem("cola:theme", v), value);
  await page.reload();
}

test("clubs: guest, application, approval and revocation use distinct states and role-scoped management", async ({
  page,
  browser,
  browserName,
}, info) => {
  await person(page.request);
  const c = await club(page.request);
  const applicant = await browser.newContext(),
    rider = await person(applicant.request, false),
    memberPage = await applicant.newPage();
  const guest = await browser.newContext(),
    guestPage = await guest.newPage();
  await guestPage.goto("/clubs/" + c.id);
  await expect(
    guestPage.getByRole("link", { name: "Войти, чтобы вступить" }),
  ).toBeVisible();
  expect(
    (await guest.request.get("/api/clubs/" + c.id + "/members")).status(),
  ).toBe(403);
  await memberPage.goto("/clubs/" + c.id);
  await memberPage
    .getByRole("button", { name: "Подать заявку", exact: true })
    .click();
  await memberPage
    .getByRole("alertdialog")
    .getByRole("button", { name: "Подать заявку", exact: true })
    .click();
  await expect(
    memberPage.getByText("Заявка отправлена", { exact: true }),
  ).toBeVisible();
  expect(
    (await applicant.request.get("/api/clubs/" + c.id + "/members")).status(),
  ).toBe(403);
  for (const theme of ["light", "dark"]) {
    for (const [screen, mode] of [
      [guestPage, "guest"],
      [memberPage, "pending"],
    ] as const) {
      await chooseTheme(screen, theme);
      await screen.setViewportSize({ width: 393, height: 852 });
      await screen.screenshot({
        path: info.outputPath("club-" + mode + "-" + theme + ".png"),
        fullPage: true,
      });
    }
  }
  await page.goto("/clubs/" + c.id + "/manage?section=members");
  const row = page.locator("article").filter({ hasText: rider.username });
  await row.getByRole("button", { name: "Принять", exact: true }).click();
  await expect(row.getByRole("combobox", { name: "Роль" })).toBeVisible();
  await memberPage.reload();
  await expect(
    memberPage.getByRole("button", { name: "Выйти из клуба" }),
  ).toBeVisible();
  expect(
    (await applicant.request.get("/api/clubs/" + c.id + "/members")).status(),
  ).toBe(200);
  expect(
    (
      await applicant.request.get("/api/clubs/" + c.id + "/members?manage=1")
    ).status(),
  ).toBe(403);
  for (const theme of ["light", "dark"]) {
    await chooseTheme(memberPage, theme);
    await memberPage.setViewportSize({ width: 393, height: 852 });
    await memberPage.screenshot({
      path: info.outputPath("club-member-" + theme + ".png"),
      fullPage: true,
    });
    await chooseTheme(page, theme);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.screenshot({
      path: info.outputPath("club-admin-" + theme + ".png"),
      fullPage: true,
    });
    if (browserName === "chromium") {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({
        path: info.outputPath("club-admin-desktop-" + theme + ".png"),
        fullPage: true,
      });
    }
  }
  const refused = await applicant.request.patch(
    "/api/clubs/" + c.id + "/members/" + rider.id,
    { headers, data: { action: "role", role: "owner" } },
  );
  expect(refused.status()).toBe(400);
  const block = await page.request.patch(
    "/api/clubs/" + c.id + "/members/" + rider.id,
    { headers, data: { action: "block" } },
  );
  expect(block.status()).toBe(200);
  expect(
    (
      await applicant.request.post("/api/clubs/" + c.id + "/membership", {
        headers,
        data: { action: "join" },
      })
    ).status(),
  ).toBe(403);
  const revoked = await applicant.request.get("/api/clubs/badges/" + rider.id);
  expect((await revoked.json()).total).toBe(0);
  await applicant.close();
  await guest.close();
});

test("badges: shared visibility/order on profile and bicycle, long names, +N and both themes", async ({
  page,
  browser,
  browserName,
}, info) => {
  await person(page.request);
  const names = [
    "Первый клуб очень длинного названия для проверки бейджа",
    "Второй клуб любителей утреннего гравия",
    "Третий клуб дальних поездок",
  ];
  const clubs = [];
  for (const name of names) clubs.push(await club(page.request, name, true));
  const member = await browser.newContext(),
    rider = await person(member.request),
    p = await member.newPage();
  for (const c of clubs) {
    const r = await member.request.post("/api/clubs/" + c.id + "/membership", {
      headers,
      data: { action: "join" },
    });
    expect(r.status()).toBe(200);
  }
  for (const path of ["/u/" + rider.username, "/b/" + rider.share]) {
    await p.goto(path);
    const shelf = p.getByLabel("Клубы участника", { exact: true });
    await expect(shelf.getByRole("link")).toHaveCount(2);
    await expect(
      shelf.getByRole("button", { name: "+1", exact: true }),
    ).toBeVisible();
    await shelf.getByRole("button", { name: "+1", exact: true }).click();
    await expect(shelf.getByRole("link")).toHaveCount(3);
    await shelf.getByRole("button", { name: "Свернуть" }).click();
    for (const width of browserName === "chromium"
      ? [320, 360, 393, 430, 768, 1440]
      : [393]) {
      await p.setViewportSize({ width, height: width > 700 ? 900 : 852 });
      for (const theme of ["light", "dark"]) {
        await chooseTheme(p, theme);
        await expect(
          p.getByLabel("Клубы участника", { exact: true }).getByRole("link"),
        ).toHaveCount(2);
        const size = await p.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
        await p.screenshot({
          path: info.outputPath(
            (path.startsWith("/u/") ? "profile" : "bike") +
              "-" +
              width +
              "-" +
              theme +
              ".png",
          ),
          fullPage: true,
        });
      }
    }
  }
  await p.goto("/account?tab=clubs");
  const label = p
    .getByRole("heading", { name: "Мои клубы", exact: true })
    .first();
  await expect(label).toBeVisible();
  const preference = p
    .locator("div")
    .filter({ has: p.getByRole("link", { name: names[0], exact: true }) })
    .filter({ has: p.getByLabel("Показывать бейдж") })
    .last();
  await preference.getByLabel("Показывать бейдж").uncheck();
  await p
    .getByRole("button", { name: "Сохранить бейджи", exact: true })
    .click();
  await p.goto("/u/" + rider.username);
  const shelf = p.getByLabel("Клубы участника", { exact: true });
  await expect(shelf.getByRole("link")).toHaveCount(2);
  await expect(
    shelf.getByRole("link", { name: names[0], exact: true }),
  ).toHaveCount(0);
  await expect(
    shelf.getByRole("button", { name: "+1", exact: true }),
  ).toHaveCount(0);
  await p.goto("/b/" + rider.share);
  await expect(
    p
      .getByLabel("Клубы участника", { exact: true })
      .getByRole("link", { name: names[0], exact: true }),
  ).toHaveCount(0);
  const leave = await member.request.post(
    "/api/clubs/" + clubs[1].id + "/membership",
    { headers, data: { action: "leave" } },
  );
  expect(leave.status()).toBe(200);
  await p.goto("/u/" + rider.username);
  await expect(
    p.getByLabel("Клубы участника", { exact: true }).getByRole("link"),
  ).toHaveCount(1);
  await member.close();
});

test("ownership acceptance races against creation under the same quota lock", async ({
  page,
  browser,
}) => {
  await person(page.request);
  let c = await club(page.request, "Клуб для передачи", true);
  const next = await browser.newContext(),
    rider = await person(next.request);
  expect(
    (
      await next.request.post("/api/clubs/" + c.id + "/membership", {
        headers,
        data: { action: "join" },
      })
    ).status(),
  ).toBe(200);
  for (let i = 0; i < 2; i++)
    await club(next.request, "Существующий клуб " + i);
  const offer = await page.request.post("/api/clubs/" + c.id + "/transfer", {
    headers,
    data: { action: "offer", targetId: rider.id, version: c.version },
  });
  expect(offer.status()).toBe(200);
  const result: { club: ClubDto } = await offer.json();
  c = result.club;
  const attempts = await Promise.all([
    next.request.post("/api/clubs/" + c.id + "/transfer", {
      headers,
      data: { action: "accept", version: c.version },
    }),
    next.request.post("/api/clubs", {
      headers,
      data: { name: "Четвёртый клуб недопустим", requestId: randomUUID() },
    }),
  ]);
  expect(attempts.filter((r) => r.status() === 409)).toHaveLength(1);
  expect(attempts.filter((r) => [200, 201].includes(r.status()))).toHaveLength(
    1,
  );
  const eligibility = await next.request.get("/api/clubs/eligibility");
  expect((await eligibility.json()).owned).toBe(3);
  await next.close();
});
