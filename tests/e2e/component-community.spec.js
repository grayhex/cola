import { test, expect, devices } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow, describeOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

test("component gallery and discussion: private owner, upload, originals, caption, cover, moderation and durable threads", async ({
  page,
  browser,
  isMobile,
}, info) => {
  const nonce = randomUUID().slice(0, 8),
    name = "Brooks Gallery " + nonce;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const context = await browser.newContext({
    ...(isMobile ? devices["iPhone 13"] : {}),
    baseURL: origin,
  });
  const reader = await context.newPage(),
    ids = [];
  const register = async (request, label) => {
    const r = await registerVerified(request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: label + nonce,
        email: `${label}-${nonce}@example.test`,
        password: "component-browser-secret-123",
      },
    });
    expect(r.status()).toBe(201);
    const id = (await r.json()).user.id;
    ids.push(id);
    return id;
  };
  try {
    const owner = await register(page.request, "gallery-owner"),
      admin = await register(reader.request, "gallery-admin");
    const bike = await page.request.post("/api/bikes/wizard", {
      headers: { origin },
      data: {
        requestId: randomUUID(),
        bike: {
          name: "Private bicycle",
          brand: "Cube",
          model: "Travel",
          year: 2024,
          category: "road",
          is_public: true,
          description: "",
          color: "",
          size: "",
          weight: null,
        },
        components: [
          { section: "build", category: "Седло", name, notes: "", price: null },
        ],
      },
    });
    expect(bike.status()).toBe(201);
    const bikeId = (await bike.json()).id;
    const model = (
      await db.query("SELECT model_id FROM components WHERE bike_id=$1", [
        bikeId,
      ])
    ).rows[0].model_id;
    expect(
      (
        await page.request.patch(`/api/bikes/${bikeId}/share`, {
          headers: { origin },
          data: { is_public: false },
        })
      ).status(),
    ).toBe(200);
    await page.goto("/components/" + model);
    const gallery = page.getByRole("region", { name: "Фотографии компонента" });
    await expect(
      gallery.getByText(
        "Фотографий пока нет. Покажите, как выглядит эта модель.",
      ),
    ).toBeVisible();
    const landscape = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#d9a949" },
    })
      .png()
      .toBuffer();
    const portrait = await sharp({
      create: { width: 600, height: 1000, channels: 3, background: "#668878" },
    })
      .jpeg()
      .toBuffer();
    for (const [index, bytes] of [landscape, portrait].entries()) {
      await gallery
        .getByLabel("Ваше фото компонента", { exact: true })
        .setInputFiles({
          name: index + "." + (index ? "jpg" : "png"),
          mimeType: index ? "image/jpeg" : "image/png",
          buffer: bytes,
        });
      await gallery
        .getByRole("button", { name: "Опубликовать фото", exact: true })
        .click();
      await expect(gallery.locator("figure")).toHaveCount(index + 1);
    }
    const first = gallery.locator("figure").first();
    await first
      .getByRole("button", { name: "Изменить подпись", exact: true })
      .click();
    await first
      .getByLabel("Подпись к фото", { exact: true })
      .fill("Седло в поездке");
    await first
      .getByRole("button", { name: "Сохранить подпись", exact: true })
      .click();
    await expect(first.locator("figcaption")).toContainText("Седло в поездке");
    await first
      .getByRole("button", {
        name: "Открыть иллюстрацию целиком: Седло в поездке",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Седло в поездке",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("img")).not.toHaveAttribute("src", /width=/);
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Ваш комментарий", exact: true })
      .fill("Кто ездил на таком седле?");
    await page
      .getByRole("button", { name: "Отправить комментарий", exact: true })
      .click();
    await expect(page.locator(".comment-body")).toHaveText(
      "Кто ездил на таком седле?",
    );
    await reader.goto("/components/" + model);
    const readerGallery = reader.getByRole("region", {
      name: "Фотографии компонента",
    });
    await expect(readerGallery.locator("figure")).toHaveCount(2);
    await expect(
      readerGallery.getByRole("button", {
        name: "Опубликовать фото",
        exact: true,
      }),
    ).toHaveCount(0);
    await reader
      .locator(".discussion")
      .getByRole("button", { name: "Ответить", exact: true })
      .click();
    await reader
      .getByRole("textbox", { name: "Ваш ответ", exact: true })
      .fill("Мне удобно на длинных поездках.");
    await reader
      .getByRole("button", { name: "Отправить ответ", exact: true })
      .click();
    await expect(reader.locator(".comment-reply .comment-body")).toHaveText(
      "Мне удобно на длинных поездках.",
    );
    await page.goto("/notifications");
    const notice = page
      .locator(".notification-list li")
      .filter({ hasText: "ответил вам в обсуждении компонента" });
    await expect(notice).toBeVisible();
    await notice.getByRole("link", { name, exact: true }).click();
    await expect(page.locator(".comment-reply .comment-body")).toHaveText(
      "Мне удобно на длинных поездках.",
    );
    // Normal reader uses the shared report UI; the same account becomes moderator.
    await readerGallery
      .locator("figure")
      .first()
      .getByRole("button", { name: "Пожаловаться", exact: true })
      .click();
    await readerGallery
      .getByRole("button", { name: "Отправить жалобу", exact: true })
      .click();
    await expect(
      readerGallery.getByText("Жалоба отправлена модератору"),
    ).toBeVisible();
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin]);
    await reader.reload();
    const adminPhotos = readerGallery.locator("figure");
    await expect(
      adminPhotos
        .last()
        .getByRole("button", { name: "Сделать обложкой", exact: true }),
    ).toBeVisible();
    const newCover = await adminPhotos.last().getAttribute("id");
    await adminPhotos
      .last()
      .getByRole("button", { name: "Сделать обложкой", exact: true })
      .click();
    await expect(adminPhotos.first()).toHaveAttribute("id", newCover);
    await adminPhotos
      .last()
      .getByRole("button", { name: "Скрыть фото", exact: true })
      .click();
    await expect(
      adminPhotos.last().getByText("Скрыто", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(gallery.getByText("Скрыто", { exact: true })).toBeVisible(); // Author retains management access.
    await adminPhotos
      .last()
      .getByRole("button", { name: "Восстановить фото", exact: true })
      .click();
    await expect(
      adminPhotos.last().getByText("Скрыто", { exact: true }),
    ).toHaveCount(0);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        localStorage.setItem("cola:theme", value);
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.reload();
      await expect(gallery.locator("figure")).toHaveCount(2);
      for (const width of isMobile ? [390, 360] : [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await gallery.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            gallery
              .locator("figure img")
              .evaluateAll((images) =>
                images.every(
                  (image) => image.complete && image.naturalWidth > 0,
                ),
              ),
          )
          .toBe(true);
        // Portraits must fit above the caption, not paint over the next card or upload form.
        const previews = await gallery.locator("figure").evaluateAll((photos) =>
          photos.map((photo) => {
            const image = photo.querySelector("img");
            const frame = image.closest("button").parentElement;
            return {
              image: image.getBoundingClientRect().toJSON(),
              frame: frame.getBoundingClientRect().toJSON(),
              captionTop: photo
                .querySelector("figcaption")
                .getBoundingClientRect().top,
            };
          }),
        );
        for (const preview of previews) {
          expect(preview.image.width).toBeGreaterThan(0);
          expect(preview.image.height).toBeGreaterThan(0);
          expect(preview.image.top).toBeGreaterThanOrEqual(
            preview.frame.top - 1,
          );
          expect(preview.image.left).toBeGreaterThanOrEqual(
            preview.frame.left - 1,
          );
          expect(preview.image.right).toBeLessThanOrEqual(
            preview.frame.right + 1,
          );
          expect(preview.image.bottom).toBeLessThanOrEqual(
            preview.frame.bottom + 1,
          );
          expect(preview.image.bottom).toBeLessThanOrEqual(
            preview.captionTop + 1,
          );
        }
        const overflow = await pageOverflow(page);
        expect(
          overflow,
          overflow ? describeOverflow(overflow) : "fits",
        ).toBeNull();
        await page.screenshot({
          path: info.outputPath(`component-community-${theme}-${width}.png`),
          fullPage: true,
        });
      }
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(axe.violations).toEqual([]);
    }
    expect(
      (
        await page.request.delete("/api/bikes/" + bikeId, {
          headers: { origin },
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await expect(gallery.locator("figure")).toHaveCount(2);
    await expect(
      gallery.getByRole("button", { name: "Опубликовать фото", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".comment-reply .comment-body")).toHaveText(
      "Мне удобно на длинных поездках.",
    );
    const ownPhoto = gallery
      .locator("figure")
      .filter({ hasText: "Седло в поездке" });
    await ownPhoto
      .getByRole("button", { name: "Удалить", exact: true })
      .click();
    await ownPhoto
      .getByRole("button", { name: "Удалить фото", exact: true })
      .click();
    await expect(gallery.locator("figure")).toHaveCount(1);
    expect(owner).toBeTruthy();
  } finally {
    await context.close();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await db.end();
  }
});
