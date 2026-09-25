import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow, describeOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const picture = (width, height, background) =>
  sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();

// #128: an illustration is a block of its own where the author puts it, a
// big one fits the column and opens whole on a click, and the showcase
// scales a cover instead of cropping it.
test("article illustrations: blocks at the cursor, fit the column, open whole", async ({
  page,
}, info) => {
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const nonce = randomUUID().slice(0, 8);
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { origin },
        data: {
          ...testConsents,
          name: "Illustrator " + nonce,
          email: `illustrator-${nonce}@example.test`,
          password: "article-images-secret-123",
        },
      })
    ).status(),
  ).toBe(201);
  const title = "Протектор " + nonce;
  await page.goto("/articles/new");
  await page.getByLabel("Заголовок статьи").fill(title);
  const editor = page.locator('[data-rich-editor="Текст статьи"] .tiptap');
  await editor.click();
  await page.keyboard.type("Первый абзац.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Второй абзац.");
  // Back to the end of the first paragraph, then upload: the picture goes
  // between the paragraphs, not to the end of the article.
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  const upload = page.getByLabel("Иллюстрация", { exact: true });
  await upload.setInputFiles({
    name: "tread.png",
    mimeType: "image/png",
    buffer: await picture(2400, 1200, "#3f7a52"),
  });
  const blocks = editor.locator(":scope > *");
  await expect(blocks).toHaveCount(3);
  await expect(blocks.nth(0)).toHaveText("Первый абзац.");
  await expect(
    blocks.nth(1).locator(".rich-photo-reference img"),
  ).toBeVisible();
  await expect(blocks.nth(2)).toHaveText("Второй абзац.");

  // The caption is typed under the picture; Enter keeps the form open.
  const caption = editor.getByLabel("Подпись к иллюстрации");
  await caption.fill("Протектор крупным планом");
  await caption.press("Enter");
  await expect(page).toHaveURL(/\/articles\/new$/);
  await page.screenshot({
    path: info.outputPath("editor.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Исходник", exact: true }).click();
  await expect(page.getByLabel("Исходник: Текст статьи")).toHaveValue(
    /^Первый абзац\.\n\n!\[Протектор крупным планом\]\(photo:[a-f0-9-]{36}\)\n\nВторой абзац\.\s*$/,
  );
  // In the source the picture goes where the cursor is, too.
  const source = page.getByLabel("Исходник: Текст статьи");
  await source.evaluate((area) => {
    const end = area.value.indexOf("Второй абзац.");
    area.focus();
    area.setSelectionRange(end, end);
  });
  await upload.setInputFiles({
    name: "valve.png",
    mimeType: "image/png",
    buffer: await picture(200, 100, "#b04a3a"),
  });
  await expect(source).toHaveValue(
    /^Первый абзац\.\n\n!\[[^\]]*\]\(photo:[a-f0-9-]{36}\)\n\n!\[\]\(photo:[a-f0-9-]{36}\)\n\nВторой абзац\.\s*$/,
  );
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page).toHaveURL(/\/articles\/[a-f0-9-]+$/);

  // Figures between the paragraphs, in the author's order.
  const prose = page.locator(".article-prose");
  const parts = prose.locator(":scope > *");
  await expect(parts).toHaveCount(4);
  await expect(parts.nth(0)).toHaveText("Первый абзац.");
  await expect(parts.nth(1).locator("figure")).toHaveCount(1);
  await expect(parts.nth(1).locator("figcaption")).toHaveText(
    "Протектор крупным планом",
  );
  await expect(parts.nth(2).locator("figure")).toHaveCount(1);
  await expect(parts.nth(3)).toHaveText("Второй абзац.");

  // A big picture fits the column; a small one keeps its size.
  const big = parts.nth(1).locator("img");
  const small = parts.nth(2).locator("img");
  await expect(big).toBeVisible();
  await expect
    .poll(() => big.evaluate((img) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  // Sizes of the picture itself, without the frame around it.
  const size = (img) =>
    img.evaluate((node) => ({
      width: node.clientWidth,
      height: node.clientHeight,
    }));
  const column = await parts.nth(1).evaluate((block) => block.clientWidth);
  const fitted = await size(big);
  expect(fitted.width).toBeLessThanOrEqual(column);
  expect(fitted.width).toBeGreaterThan(column - 4);
  expect(Math.abs(fitted.height - fitted.width / 2)).toBeLessThanOrEqual(1);
  await small.scrollIntoViewIfNeeded();
  await expect
    .poll(() => small.evaluate((img) => img.complete && img.naturalWidth))
    .toBe(200);
  expect(await size(small)).toEqual({ width: 200, height: 100 });
  // ...in the middle of the column, over its caption.
  const middle = (box) => box.x + box.width / 2;
  expect(
    Math.abs(
      middle(await small.boundingBox()) -
        middle(await parts.nth(2).boundingBox()),
    ),
  ).toBeLessThanOrEqual(1);

  // A click opens the original over the page; Escape returns to the text.
  const open = page.getByRole("button", {
    name: "Открыть иллюстрацию целиком: Протектор крупным планом",
  });
  await open.click();
  const lightbox = page.getByRole("dialog", {
    name: "Протектор крупным планом",
  });
  await expect(lightbox).toBeVisible();
  const original = lightbox.locator("img");
  await expect(original).toHaveAttribute(
    "src",
    /^\/api\/journal\/media\/[a-f0-9-]{36}$/,
  );
  await expect
    .poll(() => original.evaluate((img) => img.complete && img.naturalWidth))
    .toBe(2400);
  const viewport = page.viewportSize();
  const whole = await original.boundingBox();
  expect(whole.width).toBeLessThanOrEqual(viewport.width);
  expect(whole.height).toBeLessThanOrEqual(viewport.height);
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);
  await expect(open).toBeFocused();
  // The close button and the backdrop close it as well.
  await open.click();
  await lightbox.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(lightbox).toHaveCount(0);
  await open.click();
  await page.mouse.click(4, 4);
  await expect(lightbox).toHaveCount(0);
  const overflow = await pageOverflow(page);
  expect(overflow, overflow && describeOverflow(overflow)).toBe(null);
  await page.screenshot({
    path: info.outputPath("article.png"),
    fullPage: true,
    animations: "disabled",
  });

  // The showcase scales the cover to fit instead of cropping it.
  await page.goto("/articles");
  const cover = page
    .locator(".article-card")
    .filter({ hasText: title })
    .locator("img.article-cover");
  await expect(cover).toBeVisible();
  expect(await cover.evaluate((img) => getComputedStyle(img).objectFit)).toBe(
    "contain",
  );
  expect(errors).toEqual([]);
});
