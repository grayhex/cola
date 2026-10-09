import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { bikeWeekStart } from "../../lib/bike-week-validation.ts";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow, describeOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #378: the list of notifications has air between its rows, the text, the
// action, the date and the control stand apart, and every unread notice —
// whatever it is about — can be marked read by itself.
async function member(request, name) {
  const response = await registerVerified(request, {
    headers: { origin },
    data: {
      ...testConsents,
      name,
      email: randomUUID() + "@example.test",
      password: "notification-378-secret-123",
    },
  });
  expect(response.status()).toBe(201);
  return (await (await request.get("/api/me")).json()).user;
}
async function bikeOf(request, name) {
  const response = await request.post("/api/bikes", {
    headers: { origin },
    data: {
      name,
      brand: "Cube",
      model: "Travel",
      year: 2020,
      category: "road",
      description: "",
      color: "",
      size: "",
      weight: 14,
      is_public: true,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}
async function listingOf(request, title) {
  const response = await request.post("/api/market", {
    headers: { origin },
    data: {
      title,
      description: "Listing for the notification test",
      category: "components",
      listingType: "sale",
      condition: "used",
      price: 2500,
      currency: "RUB",
      location: "Москва",
      contact: "@seller",
      status: "active",
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}
const overlap = (a, b) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

// One notice of each kind that has its own shape: the site's own (a reused
// token), the bike of the week, a listing's term and an ordinary one with an
// actor. The newest is the first.
async function seed(db, me, friend, ids) {
  const at = (minutes) => new Date(Date.now() - minutes * 60_000);
  const insert = (type, minutes, columns = {}) => {
    const id = randomUUID();
    const row = {
      id,
      recipient_id: me,
      actor_id: null,
      type,
      dedup_key: id,
      created_at: at(minutes),
      ...columns,
    };
    const names = Object.keys(row);
    return db
      .query(
        `INSERT INTO notifications(${names.join(",")}) VALUES(${names.map((_, i) => "$" + (i + 1)).join(",")})`,
        names.map((name) => row[name]),
      )
      .then(() => id);
  };
  // The notice of the week is shown only while the bike is that week's choice;
  // the test is alone in the database, and `weekOf` removes the row again.
  const week = bikeWeekStart();
  await db.query(
    `INSERT INTO bike_weeks(week_start,bike_id,owner_id,status,source,settings,window_start,window_end,selected_at)
     VALUES($1,$2,$3,'selected','override','{}',now()-interval '7 days',now(),now())`,
    [week, ids.bike, me],
  );
  if (friend)
    await db.query(
      "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2)",
      [friend, me],
    );
  return {
    bikeWeek: await insert("bike_week", 1, {
      bike_id: ids.bike,
      dedup_key: `bike_week:${week}:${ids.bike}`,
    }),
    reuse: await insert("session_reuse", 2),
    market: await insert("market_expiring", 3, { listing_id: ids.listing }),
    ...(friend && { follow: await insert("follow", 4, { actor_id: friend }) }),
  };
}
const forgetWeek = (db) =>
  db.query("DELETE FROM bike_weeks WHERE week_start=$1", [bikeWeekStart()]);
const read = (page, id) =>
  page
    .locator(`[data-notification-id="${id}"]`)
    .getByRole("button", { name: "Отметить прочитанным" });

test("notifications: rows are apart, the date is not glued to the action, every unread notice marks itself read", async ({
  page,
  browser,
}, info) => {
  page.setDefaultTimeout(15000);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const other = await browser.newContext({
    ...info.project.use,
    baseURL: origin,
  });
  try {
    const me = await member(page.request, "Notice owner");
    const friend = await member(other.request, "Notice friend");
    const bike = await bikeOf(page.request, "Notice bike");
    const listing = await listingOf(page.request, "Notice wheels");
    const ids = await seed(db, me.id, friend.id, { bike, listing });

    await page.goto("/notifications");
    const rows = page.locator(".notification-list > li");
    await expect(rows).toHaveCount(4);
    // The newest first; each unread one says so in words and has its control.
    await expect(rows.nth(0)).toContainText("Подготовить материал для главной");
    await expect(page.locator(".notification-flag")).toHaveCount(4);
    await expect(page.locator(".notification-flag").first()).toHaveText(
      "Новое",
    );
    for (const id of Object.values(ids))
      await expect(read(page, id)).toHaveCount(1);
    await expect(page.locator(".global-nav .notification-badge")).toHaveText(
      "4",
    );

    // Air between the rows, and nothing of one row touches another.
    const boxes = [];
    for (let i = 0; i < 4; i++) boxes.push(await rows.nth(i).boundingBox());
    for (let i = 0; i < 3; i++)
      expect(
        boxes[i + 1].y - (boxes[i].y + boxes[i].height),
        `gap under row ${i}`,
      ).toBeGreaterThanOrEqual(8);

    // The regression: the link «Подготовить материал для главной» ran into the
    // date. Text, action, date and control are four boxes that do not meet.
    for (let i = 0; i < 4; i++) {
      const row = rows.nth(i);
      const parts = {
        text: await row.locator(".notification-text").boundingBox(),
        time: await row.locator(".notification-meta time").boundingBox(),
        control: await row
          .getByRole("button", { name: "Отметить прочитанным" })
          .boundingBox(),
      };
      const action = row.locator(".notification-actions");
      if (await action.count()) parts.action = await action.boundingBox();
      const names = Object.keys(parts);
      for (const a of names)
        for (const b of names)
          if (a < b)
            expect(
              overlap(parts[a], parts[b]),
              `row ${i}: ${a} meets ${b}`,
            ).toBe(false);
      if (parts.action)
        expect(
          parts.time.y,
          `row ${i}: the date is below the action`,
        ).toBeGreaterThanOrEqual(parts.action.y + parts.action.height);
      const inside = await row.boundingBox();
      for (const [name, box] of Object.entries(parts))
        expect(
          box.x + box.width,
          `row ${i}: ${name} stays in the row`,
        ).toBeLessThanOrEqual(inside.x + inside.width + 0.5);
    }
    const overflow = await pageOverflow(page);
    expect(overflow, overflow && describeOverflow(overflow)).toBe(null);

    // Colour is not the only sign: the tooltip of the control is reachable by
    // keyboard and the axe has nothing to say about the list.
    const first = read(page, ids.bikeWeek);
    await first.focus();
    await expect(first).toBeFocused();
    expect(
      (await new AxeBuilder({ page }).include(".notification-list").analyze())
        .violations,
    ).toEqual([]);

    // Each kind marks only itself, does not follow its link and the bell
    // follows the list.
    const badge = page.locator(".global-nav .notification-badge");
    const left = Object.entries(ids).length;
    for (const [index, [name, id]] of Object.entries(ids).entries()) {
      await read(page, id).click();
      await expect(
        page.locator(`[data-notification-id="${id}"]`),
        name,
      ).not.toHaveClass(/unread/);
      await expect(read(page, id)).toHaveCount(0);
      await expect(page.locator(".notification-list li.unread")).toHaveCount(
        left - index - 1,
      );
      if (index < left - 1)
        await expect(badge).toHaveText(String(left - index - 1));
      else await expect(badge).toHaveCount(0);
      await expect(page).toHaveURL(/\/notifications$/);
    }
    await expect(page.locator(".notification-list li.unread")).toHaveCount(0);
    await expect(page.locator(".notification-flag")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Прочитать все" }),
    ).toHaveCount(0);
    const unread = await db.query(
      "SELECT count(*)::int n FROM notifications WHERE recipient_id=$1 AND read_at IS NULL",
      [me.id],
    );
    expect(unread.rows[0].n).toBe(0);
  } finally {
    await forgetWeek(db);
    await other.close();
    await db.end();
  }
});

test("notifications: a mark has its own pending and error state, keeps the filter and is not sent twice", async ({
  page,
}) => {
  page.setDefaultTimeout(15000);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const me = await member(page.request, "Notice pending");
    const bike = await bikeOf(page.request, "Pending bike");
    const listing = await listingOf(page.request, "Pending wheels");
    const ids = await seed(db, me.id, null, { bike, listing });
    await page.goto("/notifications");
    const filter = page.getByRole("button", {
      name: "Непрочитанные",
      exact: true,
    });
    await filter.click();
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".notification-list > li")).toHaveCount(3);

    // The first mark of the reused token waits, then fails; the next passes.
    let release = () => {};
    const gate = new Promise((resolve) => (release = resolve));
    const calls = [];
    await page.route("**/api/community/notifications/*/read", async (route) => {
      const id = route.request().url().split("/").at(-2);
      calls.push(id);
      if (id !== ids.reuse || calls.filter((c) => c === id).length > 1)
        return route.continue();
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Сервер не ответил, повторите." }),
      });
    });
    const row = page.locator(`[data-notification-id="${ids.reuse}"]`);
    const button = read(page, ids.reuse);
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
    // Pressing again while it is out sends nothing; the other notices are free.
    await button.click({ force: true });
    await expect(read(page, ids.bikeWeek)).toBeEnabled();
    await expect(read(page, ids.market)).toBeEnabled();
    expect(calls).toEqual([ids.reuse]);
    release();

    // The failure belongs to this notice: it says so, stays unread and can be
    // tried again; nothing else on the page changed.
    await expect(row.getByRole("alert")).toHaveText(
      "Сервер не ответил, повторите.",
    );
    await expect(row).toHaveClass(/unread/);
    await expect(button).toBeEnabled();
    await expect(button).not.toHaveAttribute("aria-busy");
    await expect(page.locator(".notification-list > li.unread")).toHaveCount(3);
    await expect(
      page
        .locator(`[data-notification-id="${ids.bikeWeek}"]`)
        .getByRole("alert"),
    ).toHaveCount(0);
    const stored = await db.query(
      "SELECT read_at FROM notifications WHERE id=$1",
      [ids.reuse],
    );
    expect(stored.rows[0].read_at).toBeNull();

    await button.click();
    // Read: it leaves the unread filter, the filter and the page stay.
    await expect(row).toHaveCount(0);
    await expect(page.locator(".notification-list > li")).toHaveCount(2);
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".global-nav .notification-badge")).toHaveText(
      "2",
    );
    expect(calls.filter((id) => id === ids.reuse)).toHaveLength(2);

    // The link of a notice marks it too and still opens its target.
    await page
      .locator(`[data-notification-id="${ids.bikeWeek}"]`)
      .getByRole("link", { name: "Подготовить материал для главной" })
      .click();
    await expect(page).not.toHaveURL(/\/notifications$/);
    const marked = await db.query(
      "SELECT read_at FROM notifications WHERE id=$1",
      [ids.bikeWeek],
    );
    expect(marked.rows[0].read_at).not.toBeNull();
  } finally {
    await forgetWeek(db);
    await db.end();
  }
});
