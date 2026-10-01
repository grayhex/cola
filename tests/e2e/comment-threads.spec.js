import { test, expect, devices } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
async function member(request) {
  const response = await registerVerified(request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Thread rider",
      email: randomUUID() + "@example.test",
      password: "thread-browser-secret-123",
    },
  });
  expect(response.status()).toBe(201);
  return (await (await request.get("/api/me")).json()).user;
}
async function post(request, path, data) {
  const r = await request.post("/api/" + path, { headers: { origin }, data });
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
}
test("nested discussion: direct parents, focused chain, bounded children, edit, tombstone and reply at the visual depth cap", async ({
  page,
  browser,
  isMobile,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const context = await browser.newContext({
    ...(isMobile ? devices["iPhone 13"] : {}),
    baseURL: origin,
  });
  const users = [];
  try {
    const owner = await member(page.request),
      visitor = await member(context.request);
    users.push(owner.id, visitor.id);
    const bike = await post(page.request, "bikes", {
      name: "Nested discussion",
      brand: "Cube",
      model: "Travel",
      year: 2026,
      category: "road",
      is_public: true,
      description: "",
      color: "",
      size: "",
      weight: null,
    });
    const share = (
      await (await page.request.get("/api/bikes/" + bike.id)).json()
    ).bike.share_id;
    const endpoint = "community/bikes/" + bike.id + "/comments";
    const ids = [];
    for (const [i, request] of [
      context.request,
      page.request,
      context.request,
      page.request,
    ].entries()) {
      const result = await post(request, endpoint, {
        body: "Level " + i,
        parentId: ids.at(-1) || null,
      });
      ids.push(result.id);
    }
    // These fixture-only siblings make the selected reply fall beyond page one.
    for (let i = 0; i < 24; i++)
      await db.query(
        "INSERT INTO bike_comments(id,bike_id,author_id,parent_id,body,created_at) VALUES($1,$2,$3,$4,$5,now()-interval '1 day')",
        [randomUUID(), bike.id, visitor.id, ids[2], "Sibling " + i],
      );
    const calls = [];
    page.on("request", (r) => {
      if (r.url().includes("/comments")) calls.push(r.url());
    });
    await page.addInitScript(() =>
      localStorage.setItem("cola:theme", "system"),
    );
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/b/" + share + "?comment=" + ids[3] + "#discussion");
    await expect(page.locator(".discussion .comment")).toHaveCount(4);
    await expect(page.locator("#comment-" + ids[3])).toBeFocused();
    expect(calls.filter((u) => u.includes("/replies"))).toHaveLength(0);
    for (let i = 0; i < ids.length; i++) {
      const node = page.locator("#comment-" + ids[i]);
      await expect(
        node.getByRole("button", { name: "Ответить", exact: true }),
      ).toBeVisible();
      if (i) await expect(node).toHaveAttribute("data-parent-id", ids[i - 1]);
    }
    let target = page.locator("#comment-" + ids[3]);
    await target.getByRole("button", { name: "Ответить", exact: true }).click();
    await expect(
      target.getByText("Ответ для @" + owner.username, { exact: true }).last(),
    ).toBeVisible();
    await target.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(
      target.getByRole("textbox", { name: "Ваш ответ" }),
    ).toHaveCount(0);
    await target.getByRole("button", { name: "Ответить", exact: true }).click();
    await target
      .getByRole("textbox", { name: "Ваш ответ" })
      .fill("Level 4 via UI");
    const created = page.waitForResponse(
      (r) => r.url().endsWith("/comments") && r.request().method() === "POST",
    );
    await target
      .getByRole("button", { name: "Отправить ответ", exact: true })
      .click();
    const fifth = (await (await created).json()).id;
    ids.push(fifth);
    target = page.locator("#comment-" + fifth);
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute("data-parent-id", ids[3]);
    await target.getByRole("button", { name: "Изменить", exact: true }).click();
    await target
      .getByRole("textbox", { name: "Изменить комментарий" })
      .fill("Level 4 edited");
    await target
      .getByRole("button", { name: "Сохранить комментарий", exact: true })
      .click();
    await expect(target.locator(".comment-body")).toHaveText("Level 4 edited");
    for (const width of [390, 1440])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: theme });
        expect(
          (await new AxeBuilder({ page }).include(".discussion").analyze())
            .violations,
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const xs = await page
          .locator(
            ".comment-thread[data-depth='3'] > .comment, .comment-thread[data-depth='4'] > .comment",
          )
          .evaluateAll((nodes) =>
            nodes.map((n) => n.getBoundingClientRect().x),
          );
        expect(Math.abs(xs[0] - xs[1])).toBeLessThan(1);
        await page.locator(".discussion").screenshot({
          path: info.outputPath(`threads-${width}-${theme}.png`),
        });
      }
    const thirdThread = page.locator("#comment-" + ids[2]).locator("..");
    await thirdThread
      .getByRole("button", { name: "Показать ещё ответы · 25", exact: true })
      .click();
    await expect(
      thirdThread.getByText("Sibling 0", { exact: true }),
    ).toBeVisible();
    expect(calls.filter((u) => u.includes("/replies"))).toHaveLength(1);
    // Removing the intermediate authored node leaves the deeper child readable.
    await page.request.delete("/api/community/comments/" + ids[3], {
      headers: { origin },
    });
    await page.reload();
    await expect(
      page.locator("#comment-" + ids[3] + " .comment-body"),
    ).toHaveCount(0);
    // The URL still points at the removed node, so return with a live deep link.
    await page.goto("/b/" + share + "?comment=" + fifth);
    await expect(
      page.locator("#comment-" + fifth + " .comment-body"),
    ).toHaveText("Level 4 edited");
    await expect(page.locator("#comment-" + ids[3])).toContainText(
      "Комментарий недоступен",
    );
    await expect(
      page
        .locator("#comment-" + ids[3])
        .getByRole("button", { name: "Ответить" }),
    ).toHaveCount(0);
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [visitor.id]);
    await page.reload();
    await expect(page.locator("#comment-" + ids[2])).toContainText(
      "Комментарий недоступен",
    );
    await expect(
      page.locator("#comment-" + fifth + " .comment-body"),
    ).toHaveText("Level 4 edited");
  } finally {
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await db.end();
    await context.close();
  }
});
