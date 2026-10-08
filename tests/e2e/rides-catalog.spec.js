import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
import { gpx, loop } from "../ride-fixtures.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #370: /rides opens on upcoming rides. «Все» and «Прошедшие» are choices of
// their own and live in the address, so a reload, Back and a copied link keep
// them; «Собрать компанию» is gone and the one planning action remains.
const nonce = randomUUID().slice(0, 8);
const titles = {
  planned: "Предстоящий круг " + nonce,
  done: "Прошедший круг " + nonce,
};
const day = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
async function owner(page) {
  const suffix = randomUUID();
  const registered = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Каталог " + suffix.slice(0, 6),
      email: suffix + "@example.test",
      password: "rides-catalog-secret-123",
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
  const bike = await post("bikes", {
    name: "Каталог · велосипед",
    brand: "Cube",
    model: "Nuroad",
    year: 2024,
    category: "gravel",
    description: "",
    color: "",
    size: "",
    weight: null,
    is_public: true,
  });
  return { post, bikeId: bike.id };
}
const plan = (post, bikeId, title, passport = {}) =>
  post("rides/plan", {
    bikeId,
    title,
    description: "",
    isPublic: true,
    privacyEnabled: false,
    privacyRadiusM: 500,
    scheduledAt: `${day(6)}T10:00:00+03:00`,
    expectedEndAt: `${day(6)}T12:00:00+03:00`,
    meetingPoint: "У фонтана",
    passport,
  });
async function recorded(post, bikeId, title) {
  const preview = await post("rides/preview", gpx([loop]));
  await post("rides", {
    previewId: preview.previewId,
    bikeId,
    title,
    description: "",
    isPublic: true,
    privacyEnabled: false,
    privacyRadiusM: 500,
  });
}
const tab = (page, name) =>
  page
    .getByRole("group", { name: "Фильтр покатушек" })
    .getByRole("button", { name, exact: true });
const statusOf = (page) => new URL(page.url()).searchParams.get("status");

test("a clean address shows upcoming rides; «Все» and «Прошедшие» are kept in the address", async ({
  page,
  browser,
}, info) => {
  const { post, bikeId } = await owner(page);
  await plan(post, bikeId, titles.planned, { pace: "relaxed" });
  await recorded(post, bikeId, titles.done);
  const path = "/rides?bikeId=" + bikeId;
  const list = page.locator("main");

  // First visit: upcoming, and the address stays clean.
  await page.goto(path);
  await expect(tab(page, "Предстоящие")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(list).toContainText(titles.planned);
  await expect(list).not.toContainText(titles.done);
  expect(statusOf(page)).toBeNull();

  // «Все» is a deliberate choice: it is written down, so it survives a reload
  // and a copied link instead of turning back into the default.
  await tab(page, "Все").click();
  await expect(list).toContainText(titles.done);
  await expect(list).toContainText(titles.planned);
  await expect.poll(() => statusOf(page)).toBe("all");
  await page.reload();
  await expect(tab(page, "Все")).toHaveAttribute("aria-pressed", "true");
  await expect(list).toContainText(titles.done);
  await expect(list).toContainText(titles.planned);
  const link = page.url();
  const guest = await browser.newContext(info.project.use);
  try {
    const reader = await guest.newPage();
    await reader.goto(link);
    await expect(tab(reader, "Все")).toHaveAttribute("aria-pressed", "true");
    await expect(reader.locator("main")).toContainText(titles.done);
    await expect(reader.locator("main")).toContainText(titles.planned);
  } finally {
    await guest.close();
  }

  // «Прошедшие»: only recorded rides; Back from a ride returns to the tab.
  await tab(page, "Прошедшие").click();
  await expect.poll(() => statusOf(page)).toBe("completed");
  await expect(list).toContainText(titles.done);
  await expect(list).not.toContainText(titles.planned);
  await page.reload();
  await expect(tab(page, "Прошедшие")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: titles.done }).first().click();
  await expect(page).toHaveURL(/\/r\//);
  await page.goBack();
  await expect(tab(page, "Прошедшие")).toHaveAttribute("aria-pressed", "true");
  await expect(list).toContainText(titles.done);
  await expect(list).not.toContainText(titles.planned);

  // Back to upcoming: the default again, without a `status` in the address.
  await tab(page, "Предстоящие").click();
  await expect.poll(() => statusOf(page)).toBeNull();
  await expect(list).toContainText(titles.planned);
  await expect(list).not.toContainText(titles.done);

  // Links from before and hand-edited ones: known values only.
  await page.goto(path + "&status=planned");
  await expect(tab(page, "Предстоящие")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(list).toContainText(titles.planned);
  for (const odd of ["&status=", "&status=everything", "&status=constructor"]) {
    await page.goto(path + odd);
    await expect(tab(page, "Предстоящие")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(list).toContainText(titles.planned);
    await expect(list).not.toContainText(titles.done);
  }
});

test("status works with the other filters and an empty upcoming list offers the whole one", async ({
  page,
}) => {
  const { post, bikeId } = await owner(page);
  await plan(post, bikeId, titles.planned + " B", { pace: "relaxed" });
  const path = "/rides?bikeId=" + bikeId;
  const list = page.locator("main");

  // A filter of upcoming rides survives a visit to another tab.
  await page.goto(path + "&pace=sporty");
  await expect(
    page.getByText("По этим фильтрам предстоящих выездов нет."),
  ).toBeVisible();
  await expect(page).toHaveURL(/pace=sporty/);
  await tab(page, "Все").click();
  await expect(list).toContainText(titles.planned + " B");
  await expect.poll(() => statusOf(page)).toBe("all");
  await tab(page, "Предстоящие").click();
  await expect(page).toHaveURL(/pace=sporty/);
  await expect(
    page.getByRole("button", { name: "Убрать фильтр Спортивный" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Сбросить всё" }).first().click();
  await expect(list).toContainText(titles.planned + " B");

  // A rider with no upcoming rides: an honest empty state and a way out.
  const { post: lonely, bikeId: other } = await owner(page);
  await recorded(lonely, other, titles.done + " C");
  await page.goto("/rides?bikeId=" + other);
  await expect(
    page.getByText("Предстоящих публичных выездов пока нет."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Показать все покатушки" }).click();
  await expect(tab(page, "Все")).toHaveAttribute("aria-pressed", "true");
  await expect(list).toContainText(titles.done + " C");
  await expect.poll(() => statusOf(page)).toBe("all");
  expect(await pageOverflow(page)).toBeNull();
});

test("planning is one action: «Собрать компанию» is gone and the planner link remains", async ({
  page,
}) => {
  await owner(page);
  await page.goto("/rides");
  await expect(
    page.getByRole("button", { name: "Собрать компанию" }),
  ).toHaveCount(0);
  await expect(page.getByText("Собрать компанию")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Запланировать покатушку", exact: true }),
  ).toHaveAttribute("href", "/account?tab=rides&action=plan");
  await expect(
    page.getByRole("link", { name: "Хочу кататься", exact: true }),
  ).toHaveAttribute("href", "/ride-intents");
  expect(
    (
      await new AxeBuilder({ page })
        .include(".section-heading")
        .include(".ride-filter-bar")
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(await pageOverflow(page)).toBeNull();
});
