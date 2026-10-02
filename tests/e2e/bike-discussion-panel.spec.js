import { test, expect } from "@playwright/test";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

async function member(request, name) {
  const response = await registerVerified(request, {
    headers: { origin },
    data: {
      ...testConsents,
      name,
      email: randomUUID() + "@panel.test",
      password: "discussion-panel-secret-123",
    },
  });
  expect(response.status()).toBe(201);
}
async function post(request, path, data) {
  const response = await request.post("/api/" + path, {
    headers: { origin },
    data,
  });
  expect(response.ok(), path + " " + (await response.text())).toBe(true);
  return response.json();
}

// #291: the bike page shows a short panel of comments: the count in the
// heading, the first three threads, the rest on demand. Other pages keep
// the full discussion.
test("bike comments: a short panel opens on demand, by a link and after posting", async ({
  page,
  browser,
}, info) => {
  const guest = await browser.newContext(info.project.use);
  const commenter = await browser.newContext(info.project.use);
  try {
    await member(page.request, "Автор панели");
    await member(commenter.request, "Читатель панели");
    const created = await post(page.request, "bikes", {
      name: "Велосипед с обсуждением",
      brand: "Cube",
      model: "Travel",
      year: 2022,
      category: "urban_touring",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: true,
    });
    const { bike } = await (
      await page.request.get("/api/bikes/" + created.id)
    ).json();
    const endpoint = "community/bikes/" + created.id + "/comments";
    const ids = [];
    for (let i = 1; i <= 5; i++)
      ids.push(
        (await post(commenter.request, endpoint, { body: "Вопрос номер " + i }))
          .id,
      );
    // A reply stays behind «more replies» until the thread is opened.
    await post(page.request, endpoint, {
      body: "Ответ автора",
      parentId: ids[0],
    });
    // The heading counts what the bike's DTO counts, the same figure as the
    // «Комментарии» tile.
    const total = (
      await (await page.request.get("/api/bikes/" + created.id)).json()
    ).bike.comments;
    expect(total).toBeGreaterThanOrEqual(5);

    const reader = await guest.newPage();
    await reader.goto("/b/" + bike.share_id);
    const panel = reader.locator("#discussion");
    await expect(
      panel.getByRole("heading", {
        name: `Комментарии (${total})`,
        level: 2,
      }),
    ).toBeVisible();
    await expect(
      reader.locator(".bike-metrics").getByText(String(total), { exact: true }),
    ).toBeVisible();
    await expect(panel.locator(".comment")).toHaveCount(3);
    await expect(panel.getByText("Ответ автора")).toHaveCount(0);
    await panel.getByRole("button", { name: "Все комментарии" }).click();
    await expect(reader.locator("#discussion > .comment-thread")).toHaveCount(
      5,
    );
    await expect(
      panel.getByRole("button", { name: "Все комментарии" }),
    ).toHaveCount(0);

    // A link to one comment opens that thread with the comment in focus,
    // whatever its place in the list; «Все комментарии» returns to the list.
    for (const id of [ids[0], ids[4]]) {
      await reader.goto("/b/" + bike.share_id + "?comment=" + id);
      await expect(reader.locator("#comment-" + id)).toBeFocused();
      await expect(reader.locator("#discussion > .comment-thread")).toHaveCount(
        1,
      );
      await panel.getByRole("button", { name: "Все комментарии" }).click();
      await expect(reader.locator("#discussion > .comment-thread")).toHaveCount(
        5,
      );
    }

    // The owner's own comment is not hidden behind the button.
    await page.goto("/b/" + bike.share_id);
    await expect(page.locator("#discussion .comment")).toHaveCount(3);
    await page
      .getByRole("textbox", { name: "Ваш комментарий", exact: true })
      .fill("Новый комментарий владельца");
    await page
      .getByRole("button", { name: "Отправить комментарий", exact: true })
      .click();
    await expect(
      page.locator("#discussion .comment-body", {
        hasText: "Новый комментарий владельца",
      }),
    ).toBeVisible();
    await expect(page.locator("#discussion > .comment-thread")).toHaveCount(6);
  } finally {
    await guest.close();
    await commenter.close();
  }
});
