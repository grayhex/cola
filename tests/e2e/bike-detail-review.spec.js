import { test, expect } from "@playwright/test";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { gpx, loop } from "../ride-fixtures.js";
import sharp from "sharp";
import pg from "pg";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

test("bike detail full-page review and request budget", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const post = async (path, data) => {
    const response = await page.request.post("/api/" + path, {
      headers: { origin },
      data,
    });
    expect(response.ok(), path + " " + (await response.text())).toBe(true);
    return response.json();
  };
  expect(
    (
      await registerVerified(page.request, {
        headers: { origin },
        data: {
          ...testConsents,
          name: "Владелец городского велосипеда",
          email: randomUUID() + "@detail.test",
          password: "bike-detail-secret-123",
        },
      })
    ).status(),
  ).toBe(201);
  const { user } = await (await page.request.get("/api/me")).json();
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
  const original = await (await page.request.get("/api/admin/overview")).json();
  const setSettings = async (value) => {
    const latest = await (await page.request.get("/api/admin/overview")).json();
    expect(
      (
        await page.request.put("/api/admin/settings", {
          headers: { origin },
          data: { value, version: latest.settingsVersion },
        })
      ).status(),
    ).toBe(200);
  };
  let guest;
  try {
    await setSettings({
      ...original.settings,
      detailBlocks: original.settings.detailBlocks.map((b) => ({
        ...b,
        enabled: true,
        open: true,
      })),
    });
    const created = await post("bikes", {
      name: "Cube Travel SL · город и дальние дороги",
      brand: "Cube",
      model: "Travel SL",
      category: "urban_touring",
      year: 2021,
      size: "L",
      weight: 14.2,
      color: "Графит",
      is_public: true,
      description:
        "Велосипед для ежедневных поездок по городу и путешествий налегке. Ременная передача, планетарная втулка и удобная посадка — всё для спокойных длинных маршрутов.\n\nВ журнале сохраняю изменения комплектации и впечатления от поездок.",
      price: 95000,
      show_bike_price: false,
    });
    for (const [category, name] of [
      ["Рама", "Cube Aluminium Superlite"],
      ["Вилка", "Cube Rigid Alloy"],
      ["Задняя втулка", "Shimano Alfine 11"],
      ["Ремень", "Gates CDX"],
      ["Тормоза", "Shimano XT"],
      ["Покрышки", "Continental Contact Urban 700×37"],
      ["Руль", "Jones Loop H-Bar 710"],
      ["Седло", "Brooks Cambium C17"],
    ])
      await post(`bikes/${created.id}/components`, {
        section: "build",
        category,
        name,
        price: 12345,
        notes: "",
      });
    await post(`bikes/${created.id}/components`, {
      section: "accessories",
      category: "Передний свет",
      name: "Busch & Müller IQ-XS",
      notes: "Питание от динамо-втулки",
      price: null,
    });
    const photo = await sharp("public/rive/transparent-bike-light.png")
      .flatten({ background: "#e3e5e3" })
      .resize(1200, 800, { fit: "contain", background: "#e3e5e3" })
      .jpeg()
      .toBuffer();
    for (let i = 0; i < 3; i++)
      expect(
        (
          await page.request.post(`/api/bikes/${created.id}/photos`, {
            headers: { origin, "Content-Type": "image/jpeg" },
            data: photo,
          })
        ).status(),
      ).toBe(201);
    for (let i = 0; i < 4; i++) {
      const preview = await post(
        "rides/preview",
        gpx([
          loop.map(([lon, lat, time, elevation]) => [
            lon + i * 0.01,
            lat,
            time + i * 86400,
            elevation,
          ]),
        ]),
      );
      await post("rides", {
        previewId: preview.previewId,
        bikeId: created.id,
        title: "Поездка вдоль реки · " + (i + 1),
        description: "Спокойный маршрут",
        isPublic: i < 3,
        privacyEnabled: false,
        privacyRadiusM: 500,
      });
      await post("journal", {
        bikeId: created.id,
        kind: "service",
        title: "Запись владельца · " + (i + 1),
        body: "Проверил велосипед перед поездкой. Заменил расходники и записал впечатления.",
        status: "published",
        isPublic: true,
      });
    }
    const { bike } = await (
      await page.request.get("/api/bikes/" + created.id)
    ).json();
    const path = "/b/" + bike.share_id;
    guest = await browser.newContext(info.project.use);
    const reader = await guest.newPage();
    const requests = [],
      payloads = [],
      scripts = new Map(),
      pending = [];
    reader.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/"))
        requests.push(new URL(r.url()).pathname + new URL(r.url()).search);
    });
    reader.on("response", (r) => {
      const p = new URL(r.url()).pathname;
      if (p.endsWith(".js") || p.startsWith("/api/"))
        pending.push(
          r
            .body()
            .then((b) => {
              if (p.endsWith(".js")) scripts.set(p, gzipSync(b).length);
              else payloads.push({ path: p, bytes: b.length });
            })
            .catch(() => {}),
        );
    });
    for (const [role, tab] of [
      ["visitor", reader],
      ["owner", page],
    ]) {
      await tab.goto(path);
      // The overview is open, and the other panels are mounted but hidden:
      // their data (the rides, the entries) is loaded, they take no room.
      await expect(tab.getByRole("tab", { name: "Обзор" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(tab.locator(".bike-about")).toBeVisible();
      for (const [name, content] of [
        ["Покатушки", ".ride-list .ride-compact, .ride-list .ride-card"],
        ["Записи", ".journal-list-entry"],
        ["Комментарии", "#discussion"],
      ]) {
        await expect(tab.locator(content).first()).toBeHidden();
        await tab.getByRole("tab", { name }).click();
        await expect(tab.locator(content).first()).toBeVisible();
        await expect(tab.locator(".bike-about")).toBeHidden();
        // One panel at a time, whatever the width.
        expect(await tab.locator(".bike-tabpanel:not([hidden])").count()).toBe(
          1,
        );
      }
      await tab.getByRole("tab", { name: "Обзор" }).click();
      for (const width of [1440, 1920, 390]) {
        await tab.setViewportSize({ width, height: 1000 });
        // The composition of #291: the picture and its thumbnails side by
        // side with the identity on wide screens, one column on a phone.
        const [stage, strip, identity] = await Promise.all(
          [".photo-stage", ".gallery", ".bike-identity"].map((selector) =>
            tab.locator(selector).boundingBox(),
          ),
        );
        if (width > 900) {
          expect(identity.x).toBeGreaterThanOrEqual(stage.x + stage.width);
          expect(strip.y - (stage.y + stage.height)).toBeLessThan(24);
          expect(strip.y).toBeGreaterThanOrEqual(stage.y + stage.height);
        } else {
          expect(strip.y).toBeGreaterThanOrEqual(stage.y + stage.height);
          expect(identity.y).toBeGreaterThanOrEqual(strip.y + strip.height);
        }
        for (const theme of ["light", "dark"]) {
          await tab.evaluate((t) => {
            localStorage.setItem("cola:theme", t);
            document.documentElement.dataset.theme = t;
          }, theme);
          await tab.screenshot({
            path: info.outputPath(
              `bike-detail-${process.env.BIKE_REVIEW_PHASE || "after"}-${role}-${width}-${theme}.png`,
            ),
            fullPage: true,
            animations: "disabled",
          });
          expect(
            await tab.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          ).toBe(true);
        }
      }
    }
    await Promise.all(pending);
    const metrics = {
      requests,
      payloads,
      guestJsGzip: [...scripts.values()].reduce((a, b) => a + b, 0),
      guestJsChunks: scripts.size,
    };
    await writeFile(
      info.outputPath("bike-detail-metrics.json"),
      JSON.stringify(metrics, null, 2),
    );
    console.log("BIKE_DETAIL_METRICS", JSON.stringify(metrics));
    expect(requests.filter((p) => p.startsWith("/api/rides?"))).toHaveLength(1);
    expect(
      requests.some((p) => p === "/api/bikes" || p.startsWith("/api/shared/")),
    ).toBe(false);
    if (process.env.BIKE_REVIEW_PHASE !== "before") {
      await expect(
        reader.locator(".bike-metrics").getByText("3", { exact: true }),
      ).toBeVisible();
      await expect(reader.locator(".bike-about p")).toHaveCount(2);
      await expect(reader.locator(".gallery .thumb")).toHaveCount(3);
      await expect(reader.locator(".journal-list-entry")).toHaveCount(3);
      await reader.getByRole("tab", { name: "Записи" }).click();
      await reader
        .getByRole("button", { name: "Все записи", exact: true })
        .click();
      await expect(reader.locator(".journal-list-entry")).toHaveCount(4);
      // Each tab shows its own panel, and the address follows.
      const tabs = reader.getByRole("tablist", { name: "Разделы велосипеда" });
      await tabs.getByRole("tab", { name: "Комплектация" }).click();
      await expect(reader).toHaveURL(/#specifications$/);
      await expect(
        tabs.getByRole("tab", { name: "Комплектация" }),
      ).toHaveAttribute("aria-selected", "true");
      await tabs.getByRole("tab", { name: "Комментарии" }).click();
      await expect(reader.locator("#discussion")).toBeVisible();
      await tabs.getByRole("tab", { name: "Комплектация" }).click();
      // One list holds every part: the build and the accessories.
      await expect(reader.locator(".specifications .compact-part")).toHaveCount(
        9,
      );
      await reader
        .getByRole("button", { name: /Оборудование и аксессуары/ })
        .click();
      await expect(
        reader.locator(".spec-accessories .compact-part"),
      ).toBeVisible();
    }
  } finally {
    await setSettings(original.settings);
    await guest?.close();
    await db.end();
  }
});
