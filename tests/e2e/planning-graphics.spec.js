import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

test("independent planning graphics: local uploads, protected usage, lazy animation, reduced motion and compact accessible headers", async ({
  page,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const original = (
    await db.query("SELECT value FROM site_settings WHERE id=1")
  ).rows[0].value;
  let user;
  const ids = [];
  try {
    const r = await registerVerified(page.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Planning graphics editor",
        email: randomUUID() + "@example.test",
        password: "planning-graphics-123",
      },
    });
    expect(r.status()).toBe(201);
    user = (await (await page.request.get("/api/me")).json()).user.id;
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user]);
    expect(
      (
        await page.request.post("/api/bikes", {
          headers: { origin },
          data: {
            name: "Planning graphics bike",
            brand: "Cube",
            model: "Travel",
            year: 2026,
            category: "road",
            is_public: true,
            description: "",
            color: "",
            size: "",
            weight: null,
          },
        })
      ).status(),
    ).toBe(201);
    await page.addInitScript(() =>
      localStorage.setItem("cola:theme", "system"),
    );
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    await page.getByRole("button", { name: "Графика", exact: true }).click();
    await page
      .getByRole("button", { name: "Системные иллюстрации", exact: true })
      .click();
    const slots = [
      [
        "Новое намерение · графика",
        "intentDialogGraphic",
        {
          name: "intent.png",
          mimeType: "image/png",
          buffer: await sharp(
            Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><circle cx="80" cy="50" r="38" fill="#c58b15"/><path d="M55 50h50M80 25v50" stroke="#fff" stroke-width="8"/></svg>',
            ),
          )
            .png()
            .toBuffer(),
        },
      ],
      [
        "Организовать покатушку · графика",
        "planDialogGraphic",
        {
          name: "planning.riv",
          mimeType: "application/octet-stream",
          buffer: await readFile(
            new URL(
              "../../assets/rive/transparent-bike.source.riv",
              import.meta.url,
            ),
          ),
        },
      ],
    ];
    for (const [label, , file] of slots) {
      const uploaded = page.waitForResponse(
        (r) =>
          r.url().includes("/api/admin/assets?") &&
          r.request().method() === "POST",
      );
      await page
        .getByLabel("Файл: " + label, { exact: true })
        .setInputFiles(file);
      const response = await uploaded;
      expect(response.status()).toBe(201);
      const id = (await response.json()).id;
      ids.push(id);
      await expect(
        page.getByRole("combobox", { name: label, exact: true }),
      ).toHaveValue(id);
    }
    await page.getByRole("button", { name: "Сохранить", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("Настройки опубликованы на сайте", { exact: true }),
    ).toBeVisible();
    const saved = (await db.query("SELECT value FROM site_settings WHERE id=1"))
      .rows[0].value;
    expect(saved.intentDialogGraphic).toEqual({
      kind: "image",
      assetId: ids[0],
    });
    expect(saved.planDialogGraphic).toEqual({ kind: "rive", assetId: ids[1] });
    const version = (
      await db.query("SELECT version FROM site_settings WHERE id=1")
    ).rows[0].version;
    for (const graphic of [
      { kind: "image", assetId: ids[1] },
      { kind: "rive", assetId: ids[0] },
      { kind: "image", assetId: "https://example.test/remote.png" },
    ]) {
      expect(
        (
          await page.request.put("/api/admin/settings", {
            headers: { origin },
            data: {
              version,
              value: { ...saved, intentDialogGraphic: graphic },
            },
          })
        ).status(),
      ).toBe(400);
    }
    const library = await (
      await page.request.get("/api/admin/assets/library")
    ).json();
    for (const [i, [label]] of slots.entries()) {
      expect(library.assets.find((a) => a.id === ids[i]).usage).toContain(
        label,
      );
      expect(
        (
          await page.request.delete("/api/admin/assets/" + ids[i], {
            headers: { origin },
          })
        ).status(),
      ).toBe(409);
    }
    await page.screenshot({
      path: info.outputPath("planning-graphics-admin.png"),
      fullPage: true,
    });
    const assetRequests = [];
    page.on("request", (r) => {
      if (r.url().includes(".wasm") || ids.some((id) => r.url().includes(id)))
        assetRequests.push(r.url());
    });
    await page.goto("/");
    await expect(page.locator("#together-heading")).toBeVisible();
    expect(assetRequests).toHaveLength(0);
    const actions = page.locator("section[aria-labelledby='together-heading']");
    for (const width of [390, 1366, 1440, 1920])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({
          width,
          height:
            width === 1920
              ? 1080
              : width === 1440
                ? 900
                : width === 1366
                  ? 768
                  : 844,
        });
        await page.emulateMedia({ colorScheme: theme });
        for (const [button, title, slot] of [
          ["Хочу кататься", "Новое намерение", "intentDialogGraphic"],
          [
            "Организовать покатушку",
            "Организовать покатушку",
            "planDialogGraphic",
          ],
        ]) {
          const opener = actions.getByRole("button", {
            name: button,
            exact: true,
          });
          await opener.focus();
          await page.keyboard.press("Enter");
          const dialog = page.getByRole("dialog", { name: title, exact: true });
          await expect(dialog).toBeVisible();
          const graphic = dialog.locator(`[data-planning-graphic='${slot}']`);
          await expect(graphic).toBeVisible();
          await expect(dialog.locator(".modal-head")).toContainText(title);
          // #397: the art is a square in the body; the centered header is compact.
          const head = dialog.locator(".modal-head");
          const art = await graphic.boundingBox();
          const headBox = await head.boundingBox();
          const titleBox = await head.getByRole("heading").boundingBox();
          expect(Math.abs(art.width - art.height)).toBeLessThan(2);
          expect(art.width).toBeGreaterThanOrEqual(width >= 900 ? 300 : 90);
          expect(art.y).toBeGreaterThanOrEqual(headBox.y + headBox.height - 1);
          expect(
            Math.abs(
              titleBox.x + titleBox.width / 2 - (headBox.x + headBox.width / 2),
            ),
          ).toBeLessThan(4);
          expect(headBox.height).toBeLessThanOrEqual(80);
          if (width === 1440 || width === 1920) {
            const geometry = await dialog.evaluate((e) => ({
              scroll: e.scrollHeight,
              client: e.clientHeight,
              children: Array.from(e.children, (c) => ({
                class: c.className,
                height: c.getBoundingClientRect().height,
              })),
            }));
            expect(
              geometry.scroll > geometry.client + 1,
              JSON.stringify({ slot, width, theme, ...geometry }),
            ).toBe(false);
            const columns = dialog.locator(
              ".planning-side-layout > .planning-side-column",
            );
            const first = await columns.first().boundingBox();
            expect(first.x).toBeGreaterThan(art.x + art.width);
          }
          if (slot === "intentDialogGraphic") {
            await expect(head.locator(".modal-description")).toHaveCount(0);
            const hint = head.getByRole("button", {
              name: "Подробнее: Намерение",
              exact: true,
            });
            await hint.click();
            await expect(head.getByRole("tooltip")).toContainText(
              "конкретный раз",
            );
            if (width === 1440 && theme === "light") {
              await head.getByRole("tooltip").hover();
              await page.waitForTimeout(5100);
              await expect(head.getByRole("tooltip")).toBeVisible();
            }
            await page.keyboard.press("Escape");
            await expect(dialog).toBeVisible();
            await expect(head.getByRole("tooltip")).toBeHidden();
          }
          if (slot === "intentDialogGraphic") {
            await expect(graphic.locator("img")).toHaveAttribute(
              "src",
              new RegExp("/api/assets/" + ids[0] + "$"),
            );
            await expect
              .poll(() =>
                graphic
                  .locator("img")
                  .evaluate((e) => e.complete && e.naturalWidth > 0),
              )
              .toBe(true);
            expect(
              await graphic
                .locator("img")
                .evaluate((e) => getComputedStyle(e).objectFit),
            ).toBe("contain");
          } else await expect(graphic.locator("canvas")).toHaveCount(0);
          expect(
            (await new AxeBuilder({ page }).include("dialog[open]").analyze())
              .violations,
          ).toEqual([]);
          expect(
            await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth),
          ).toBe(true);
          await dialog.screenshot({
            path: info.outputPath(`${slot}-${width}-${theme}.png`),
          });
          await page.keyboard.press("Escape");
          await expect(dialog).toHaveCount(0);
          await expect(opener).toBeFocused();
        }
      }
    expect(assetRequests.some((u) => u.includes(".wasm"))).toBe(false);
    await actions
      .getByRole("button", { name: "Организовать покатушку", exact: true })
      .click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.locator("[data-rive-ready='true']")).toBeVisible();
    expect(assetRequests.some((u) => u.includes(".wasm"))).toBe(true);
    expect(assetRequests.some((u) => u.includes(ids[1]))).toBe(true);
    await page
      .getByRole("dialog")
      .screenshot({ path: info.outputPath("planning-rive-active.png") });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("dialog canvas")).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Both unset slots retain the ordinary heading without reserved art space.
    await db.query(
      "UPDATE site_settings SET value=value || $1::jsonb WHERE id=1",
      [JSON.stringify({ intentDialogGraphic: null, planDialogGraphic: null })],
    );
    await page.reload();
    await actions
      .getByRole("button", { name: "Хочу кататься", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Новое намерение" }),
    ).toBeVisible();
    await expect(page.locator("[data-planning-graphic]")).toHaveCount(0);
  } finally {
    await db.query(
      "UPDATE site_settings SET value=$1,version=version+1 WHERE id=1",
      [original],
    );
    for (const id of ids)
      await page.request.delete("/api/admin/assets/" + id, {
        headers: { origin },
      });
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user]);
    await db.end();
  }
});
