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
    // Photo actions sit in the page's action row; their windows open over the
    // page (#264).
    const tools = page.getByRole("group", { name: "Действия с компонентом" });
    const uploadWindow = page.getByRole("dialog", {
      name: "Загрузить фото компонента",
    });
    const managePanel = page.getByRole("dialog", { name: "Управление фото" });
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
      await tools
        .getByRole("button", { name: "Загрузить фото", exact: true })
        .click();
      await uploadWindow
        .getByLabel("Ваше фото компонента", { exact: true })
        .setInputFiles({
          name: index + "." + (index ? "jpg" : "png"),
          mimeType: index ? "image/jpeg" : "image/png",
          buffer: bytes,
        });
      await uploadWindow
        .getByRole("button", { name: "Опубликовать фото", exact: true })
        .click();
      await expect(gallery.locator("figure")).toHaveCount(index + 1);
    }
    const componentPath = page.url();
    await page.goto("/components?" + new URLSearchParams({ q: name }));
    const catalogResults = page.getByRole("region", {
      name: "Модели компонентов",
    });
    await expect(catalogResults.locator("img")).toHaveCount(1);
    await expect(catalogResults.locator("img")).toHaveAttribute(
      "src",
      /\/api\/components\/media\/.*width=640/,
    );
    await expect
      .poll(() =>
        catalogResults
          .locator("img")
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    await catalogResults.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(componentPath);
    await expect(gallery.locator("figure")).toHaveCount(2);
    const rail = gallery.getByRole("region", {
      name: "Фото компонента; стрелки, Home и End для выбора",
    });
    const scrubber = gallery.getByRole("slider", {
      name: "Выбор фото компонента",
    });
    // All manual controls work with both the normal and live reduced-motion modes.
    for (const reducedMotion of ["no-preference", "reduce"]) {
      await page.emulateMedia({ reducedMotion });
      await rail.focus();
      await rail.press("End");
      await expect(scrubber).toHaveValue("2");
      await expect(gallery.locator("figure:not([inert])")).toHaveCount(1);
      await expect(
        gallery.getByRole("button", { name: "Следующее фото компонента" }),
      ).toBeDisabled();
      await rail.press("Home");
      await expect(scrubber).toHaveValue("1");
      await scrubber.focus();
      await scrubber.press("ArrowRight");
      await expect(scrubber).toHaveValue("2");
      await gallery
        .getByRole("button", { name: "Предыдущее фото компонента" })
        .click();
      await expect(scrubber).toHaveValue("1");
      await gallery
        .getByRole("navigation", { name: "Миниатюры фотографий" })
        .getByRole("button")
        .last()
        .click();
      await expect(scrubber).toHaveValue("2");
      await rail.focus();
      await rail.press("Home");
      await expect(scrubber).toHaveValue("1");
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    if (!isMobile) {
      await rail.hover();
      await page.mouse.wheel(0, 100);
      await expect(scrubber).toHaveValue("2");
      await rail.focus();
      await rail.press("Home");
      await expect(scrubber).toHaveValue("1");
      const box = await rail.boundingBox();
      await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2, {
        steps: 12,
      });
      await page.mouse.up();
      await expect(scrubber).toHaveValue("2");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await rail.focus();
      await rail.press("Home");
      await expect(scrubber).toHaveValue("1");
    }
    await tools
      .getByRole("button", { name: "Загрузить фото", exact: true })
      .click();
    const uploadDialog = uploadWindow;
    await expect(uploadDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(uploadDialog).not.toBeVisible();
    await expect(
      tools.getByRole("button", { name: "Загрузить фото", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("heading", {
        name: "Велосипеды с этим компонентом",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /На каких моделях стоит|Сборки владельцев/,
      }),
    ).toHaveCount(0);
    const trail = page.getByRole("navigation", { name: "Путь компонента" });
    await expect(trail.getByRole("link")).toHaveCount(4);
    await expect(
      trail.getByRole("link", { name: "Седло", exact: true }),
    ).toHaveAttribute("href", /category=/);
    const first = gallery.locator("figure").first();
    await tools
      .getByRole("button", { name: "Управление фото", exact: true })
      .click();
    await managePanel
      .getByRole("button", { name: "Изменить подпись", exact: true })
      .click();
    await managePanel
      .getByLabel("Подпись к фото", { exact: true })
      .fill("Седло в поездке");
    await managePanel
      .getByRole("button", { name: "Сохранить подпись", exact: true })
      .click();
    await expect(first.locator("figcaption")).toContainText("Седло в поездке");
    await managePanel
      .getByRole("button", { name: "Закрыть панель", exact: true })
      .click();
    await expect(managePanel).toHaveCount(0);
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
    const readerTools = reader.getByRole("group", {
      name: "Действия с компонентом",
    });
    const readerPanel = reader.getByRole("dialog", { name: "Управление фото" });
    await expect(
      readerTools.getByRole("button", {
        name: "Загрузить фото",
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
    await expect(page).toHaveURL(/[?&]comment=[^&#]+#discussion$/);
    await expect(page.locator("#discussion")).toBeInViewport();
    // Normal reader uses the shared report UI; the same account becomes moderator.
    await readerTools
      .getByRole("button", { name: "Управление фото", exact: true })
      .click();
    await readerPanel
      .getByRole("button", { name: "Пожаловаться", exact: true })
      .click();
    await readerPanel
      .getByRole("button", { name: "Отправить жалобу", exact: true })
      .click();
    await expect(
      readerPanel.getByText("Жалоба отправлена модератору"),
    ).toBeVisible();
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin]);
    await reader.reload();
    const adminPhotos = readerGallery.locator("figure");
    const selectLast = async (area) => {
      // This scenario alternates two accounts/tabs. WebKit may suspend the
      // carousel's animation frames in the background; interact in the active tab.
      await area.page().bringToFront();
      // Right after a reload the thumbnails are server HTML, and a click that
      // lands before hydration does nothing in WebKit (see rides.spec.js):
      // click until the slider follows.
      const slider = area.getByRole("slider", {
        name: "Выбор фото компонента",
      });
      await expect(async () => {
        await area
          .getByRole("navigation", { name: "Миниатюры фотографий" })
          .getByRole("button")
          .last()
          .click({ timeout: 2000 });
        await expect(slider).toHaveValue("2", { timeout: 2000 });
      }).toPass({ timeout: 15000 });
      await expect
        .poll(() =>
          area
            .getByRole("region", {
              name: "Фото компонента; стрелки, Home и End для выбора",
            })
            .evaluate((node) => Math.abs(node.scrollLeft - node.clientWidth)),
        )
        .toBeLessThan(2);
      await expect(area.locator("figure").last()).toHaveAttribute(
        "aria-hidden",
        "false",
      );
    };
    // The active photo's actions open in a window from the action row.
    const manage = async (area) => {
      const panel = area
        .page()
        .getByRole("dialog", { name: "Управление фото" });
      if (!(await panel.isVisible()))
        await area
          .page()
          .getByRole("group", { name: "Действия с компонентом" })
          .getByRole("button", { name: "Управление фото", exact: true })
          .click();
      await expect(panel).toBeVisible();
      return panel;
    };
    const close = async (panel) => {
      await panel
        .getByRole("button", { name: "Закрыть панель", exact: true })
        .click();
      await expect(panel).toHaveCount(0);
    };
    await selectLast(readerGallery);
    let panel = await manage(readerGallery);
    await expect(
      panel.getByRole("button", {
        name: "Сделать обложкой",
        exact: true,
      }),
    ).toBeVisible();
    const newCover = await adminPhotos.last().getAttribute("id");
    await panel
      .getByRole("button", { name: "Сделать обложкой", exact: true })
      .click();
    await expect(adminPhotos.first()).toHaveAttribute("id", newCover);
    await close(panel);
    await selectLast(readerGallery);
    panel = await manage(readerGallery);
    await panel
      .getByRole("button", { name: "Скрыть фото", exact: true })
      .click();
    await expect(
      adminPhotos.last().getByText("Скрыто", { exact: true }),
    ).toBeVisible();
    // Leave the notification deep link: its async discussion scroll must not
    // compete with gallery clicks or the later theme/viewport checks on reload.
    await page.goto("/components/" + model);
    await selectLast(gallery);
    await expect(gallery.getByText("Скрыто", { exact: true })).toBeVisible(); // Author retains management access.
    await panel
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
        // Read both rectangles in one DOM evaluation, in document order, so
        // scrolling cannot put them in different viewport coordinate frames.
        const layout = await gallery
          .getByRole("region", {
            name: "Фото компонента; стрелки, Home и End для выбора",
          })
          .or(page.getByRole("region", { name: "Описание", exact: true }))
          .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().toJSON()),
          );
        expect(layout).toHaveLength(2);
        if (width > 800)
          expect(layout[1].x).toBeGreaterThan(layout[0].x + layout[0].width);
        else
          expect(layout[1].y).toBeGreaterThan(layout[0].y + layout[0].height);
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
      tools.getByRole("button", { name: "Загрузить фото", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".comment-reply .comment-body")).toHaveText(
      "Мне удобно на длинных поездках.",
    );
    await gallery
      .getByRole("button", { name: /Показать фото .*Седло в поездке/ })
      .click();
    await expect(gallery.locator("figure:not([inert])")).toContainText(
      "Седло в поездке",
    );
    panel = await manage(gallery);
    await panel.getByRole("button", { name: "Удалить", exact: true }).click();
    await panel
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
