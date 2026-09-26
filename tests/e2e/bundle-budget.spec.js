import { verifyCapturedEmail } from "../fixtures/verified-user.js";
import { test, expect } from "@playwright/test";

// #79: a guest must not download the comment editor, the bike wizard or the
// owner's tools with the home page or the showcase. Sizes are the compressed
// bytes the browser receives from `next start`.
const budgets = [
  ["/", 220],
  ["/bikes", 250],
];
for (const [path, limitKb] of budgets)
  test(`guest JavaScript on ${path} stays within ${limitKb} KB gzip`, async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "Bundle sizes do not depend on the browser; measured once in Chromium",
    );
    const scripts = [];
    page.on("requestfinished", (request) => {
      if (request.resourceType() === "script") scripts.push(request);
    });
    await page.goto(path, { waitUntil: "networkidle" });
    const sizes = await Promise.all(
      scripts.map(async (request) => ({
        path: new URL(request.url()).pathname,
        bytes: (await request.sizes()).responseBodySize,
      })),
    );
    const totalKb = sizes.reduce((sum, s) => sum + s.bytes, 0) / 1024;
    const largest = sizes
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5)
      .map((s) => `  ${s.path} ${Math.round(s.bytes / 1024)} KB`)
      .join("\n");
    expect(
      totalKb,
      `JavaScript on ${path}: ${Math.round(totalKb)} KB gzip, budget ${limitKb} KB.\n` +
        `Largest chunks:\n${largest}\n` +
        "Load heavy parts with next/dynamic (see issue #79).",
    ).toBeLessThanOrEqual(limitKb);
  });

// #117: entries, articles and comments come parsed from the server, so a
// reader renders them without the Markdown parser and the editor.
test("guests read an entry, an article and comments without the editor", async ({
  page,
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Bundle contents do not depend on the browser; checked once in Chromium",
  );
  const { testConsents } = await import("../fixtures/legal.js");
  const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
  const author = await browser.newContext();
  const call = async (path, data) => {
    const response = await author.request.post(origin + "/api/" + path, {
      headers: { origin },
      data,
    });
    expect(response.ok(), path + " " + (await response.text())).toBe(true);
    if (path === "auth/register") await verifyCapturedEmail(data.email);
    return response.json();
  };
  const nonce = Date.now().toString(36);
  await call("auth/register", {
    ...testConsents,
    name: "Reader " + nonce,
    email: `reader-${nonce}@example.test`,
    password: "bundle-budget-secret-123",
  });
  const bike = await call("bikes", {
    name: "Reader bike " + nonce,
    brand: "Cube",
    model: "Travel",
    year: 2020,
    category: "road",
    description: "",
    color: "",
    size: "",
    weight: null,
    is_public: true,
  });
  const entry = await call("journal", {
    bikeId: bike.id,
    kind: "story",
    title: "Разметка " + nonce,
    body: "**Жирный** текст и [ссылка](https://example.com/path)\n\n- пункт",
    status: "published",
    isPublic: true,
  });
  await call("journal/" + entry.id + "/comments", { body: "*курсив* в ответе" });
  const article = await call("articles", {
    title: "Статья " + nonce,
    body: "## Подзаголовок\n\n> цитата из статьи",
    topicId: "maintenance",
    status: "published",
  });
  await author.close();

  const scripts = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") scripts.push(response);
  });
  await page.goto("/j/" + entry.shareId, { waitUntil: "networkidle" });
  await expect(page.locator(".journal-body strong")).toHaveText("Жирный");
  await expect(page.locator(".journal-body a")).toHaveAttribute(
    "href",
    "https://example.com/path",
  );
  await expect(page.locator(".journal-body li")).toHaveText("пункт");
  await expect(page.locator(".comment-body em")).toHaveText("курсив");
  await page.goto("/articles/" + article.shareId, { waitUntil: "networkidle" });
  await expect(page.locator(".article-prose h3")).toHaveText("Подзаголовок");
  await expect(page.locator(".article-prose blockquote")).toContainText(
    "цитата из статьи",
  );
  expect(scripts.length).toBeGreaterThan(0);
  for (const response of scripts)
    expect(
      await response.text(),
      new URL(response.url()).pathname + " carries the editor",
    ).not.toContain("ProseMirror");
});
