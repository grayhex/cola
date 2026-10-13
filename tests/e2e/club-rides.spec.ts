import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import type { ClubDto } from "../../lib/club-contracts.ts";
import type { RideDto } from "../../app/ui/content-types.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100",
  headers = { origin };
async function person(request: APIRequestContext, bike = false) {
  const r = await registerVerified(request, {
    headers,
    data: {
      ...testConsents,
      name: "Клубный райдер " + randomUUID().slice(0, 5),
      email: randomUUID() + "@example.test",
      password: "club-rides-fixture-413",
    },
  });
  expect(r.status()).toBe(201);
  if (bike)
    expect(
      (
        await request.post("/api/bikes", {
          headers,
          data: {
            name: "Приватный велосипед",
            brand: "Cube",
            model: "Travel",
            year: 2026,
            category: "road",
            is_public: false,
            description: "",
            color: "",
            size: "",
            weight: null,
          },
        })
      ).status(),
    ).toBe(201);
}
async function club(request: APIRequestContext) {
  await person(request, true);
  const r = await request.post("/api/clubs", {
    headers,
    data: {
      name: "Клуб любителей вечерних поездок",
      joinMode: "open",
      requestId: randomUUID(),
    },
  });
  expect(r.status()).toBe(201);
  const d: { club: ClubDto } = await r.json();
  return d.club;
}
test("club planner uses the real private bike and internal default; joining never answers; departure revokes web/v1/comment access", async ({
  page,
  browser,
}) => {
  const c = await club(page.request),
    guest = await browser.newContext(),
    member = await browser.newContext();
  try {
    await page.goto("/clubs/" + c.id + "?tab=rides");
    await page
      .getByRole("button", { name: "Запланировать выезд клуба" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Организовать покатушку" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Кто видит покатушку")).toHaveValue("false");
    await expect(dialog.getByLabel("От кого выезд")).toHaveValue(c.id);
    await dialog
      .getByLabel("Дата", { exact: true })
      .fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
    await dialog.getByLabel("Старт", { exact: true }).fill("18:00");
    await dialog
      .getByLabel("Название", { exact: true })
      .fill("Внутренний вечерний круг");
    await dialog
      .getByLabel("Место встречи", { exact: true })
      .fill("Секретные ворота клуба");
    await dialog
      .getByRole("button", { name: "Создать покатушку", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Внутренний вечерний круг" }),
    ).toBeVisible();
    const d: { rides: RideDto[] } = await (
        await page.request.get("/api/clubs/" + c.id + "/rides")
      ).json(),
      r = d.rides[0];
    expect(r.club?.audience).toBe("members");
    expect(
      (await guest.request.get("/api/rides/public/" + r.shareId)).status(),
    ).toBe(404);
    expect((await guest.request.get("/api/v1/rides/" + r.id)).status()).toBe(
      404,
    );
    const gd: { rides: RideDto[] } = await (
      await guest.request.get("/api/clubs/" + c.id + "/rides")
    ).json();
    expect(gd.rides).toHaveLength(0);
    await person(member.request);
    expect(
      (
        await member.request.post("/api/clubs/" + c.id + "/membership", {
          headers,
          data: { action: "join" },
        })
      ).status(),
    ).toBe(200);
    const md: { ride: RideDto } = await (
      await member.request.get("/api/rides/public/" + r.shareId)
    ).json();
    expect(md.ride.participation).toBe("none");
    expect(md.ride.meetingPoint).toBe("");
    expect((await member.request.get("/api/v1/rides/" + r.id)).status()).toBe(
      200,
    );
    const v1 = await (await member.request.get("/api/v1/rides/" + r.id)).text();
    expect(v1).not.toContain("Приватный велосипед");
    expect(v1).not.toContain("Секретные ворота");
    expect(
      (
        await member.request.post("/api/rides/" + r.id + "/comments", {
          headers,
          data: { body: "Внутреннее обсуждение" },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await member.request.post("/api/clubs/" + c.id + "/membership", {
          headers,
          data: { action: "leave" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await member.request.get("/api/rides/public/" + r.shareId)).status(),
    ).toBe(404);
    expect((await member.request.get("/api/v1/rides/" + r.id)).status()).toBe(
      404,
    );
    expect(
      (await member.request.get("/api/rides/" + r.id + "/comments")).status(),
    ).toBe(404);
    await page
      .getByRole("button", { name: "Отменить выезд", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Отменить выезд", exact: true })
      .click();
    await expect(page.getByText("Отменена", { exact: true })).toBeVisible();
  } finally {
    await guest.close();
    await member.close();
  }
});
test("club rides and composer fit both themes on phone, tablet and desktop", async ({
  page,
  browserName,
}, info) => {
  const c = await club(page.request);
  const widths =
    browserName === "webkit" ? [393] : [320, 360, 393, 430, 768, 1440];
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"])
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/clubs/" + c.id + "?tab=rides");
      await page.evaluate((t) => localStorage.setItem("cola:theme", t), theme);
      await page.reload();
      await page
        .getByRole("button", { name: "Запланировать выезд клуба" })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Организовать покатушку",
      });
      await expect(dialog.getByLabel("От кого выезд")).toHaveValue(c.id);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 2),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath("club-planner-" + theme + "-" + width + ".png"),
      });
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(dialog).toBeHidden();
    }
});
