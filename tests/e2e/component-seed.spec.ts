import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { userRow } from "../support/people.ts";
import { hashPassword } from "../../lib/password.ts";
import {
  loadCatalogSeedBundle,
  defaultSeedDirectory,
} from "../../scripts/component-catalog-seed.ts";
import { preparedSeedMedia } from "../../scripts/component-catalog-import.ts";
import {
  planCatalogSeed,
  applyCatalogSeed,
} from "../../lib/component-seed-import.ts";
import type { transaction as transactionType } from "../../lib/db.ts";

const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("seeded product has a public zero-build card, attributed gallery and picker options for guests and members", async ({
  page,
  browser,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const tx: typeof transactionType = async (fn) => {
    await db.query("BEGIN");
    try {
      const value = await fn({ ...db, query: db.query.bind(db), release() {} });
      await db.query("COMMIT");
      return value;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  };
  const suffix = randomUUID();
  const password = "Seed-browser-password-390";
  const admin = await userRow(db, {
    role: "admin",
    email_verified_at: new Date(),
    password_hash: await hashPassword(password),
  });
  const bundle = await loadCatalogSeedBundle(defaultSeedDirectory);
  const entry = bundle.batch.entries.find((e) => e.name === "Brooks B66");
  expect(entry).toBeDefined();
  if (!entry) throw new Error("Missing real seed");
  const batch = {
    ...bundle.batch,
    batch: "browser-" + suffix,
    entries: [entry],
  };
  const media = await preparedSeedMedia({ ...bundle, batch });
  let modelId: string | null = null;
  try {
    const plan = await planCatalogSeed(db, batch, bundle.sha256, admin.id);
    expect(plan.entries[0].action).toBe("new");
    const applied = await applyCatalogSeed(
      tx,
      batch,
      plan,
      {
        file: "disposable-browser-db",
        sha256: "0".repeat(64),
        bytes: 1,
        createdAt: new Date().toISOString(),
      },
      media,
    );
    modelId = applied[0].modelId;
    const response = await page.request.get(
      "/api/components?" + new URLSearchParams({ q: entry.name }),
    );
    expect(response.ok()).toBe(true);
    const catalog = await response.json();
    expect(catalog.items[0].builds).toBe(0);
    await page.goto("/components?" + new URLSearchParams({ q: entry.name }));
    await expect(
      page
        .getByRole("region", { name: "Модели компонентов" })
        .getByRole("heading", { name: entry.name, exact: true }),
    ).toBeVisible();
    await page.goto("/components/" + modelId);
    await expect(
      page.getByRole("region", { name: "Описание", exact: true }),
    ).toContainText(entry.description || "");
    const gallery = page.getByRole("region", {
      name: "Фотографии компонента",
      exact: true,
    });
    await expect(gallery.locator("img").first()).toBeVisible();
    await expect
      .poll(() =>
        gallery
          .locator("img")
          .first()
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
      )
      .toBe(true);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => {
        localStorage.setItem("cola:theme", t);
        window.dispatchEvent(new Event("storage"));
      }, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.screenshot({
        path: info.outputPath("seed-" + theme + ".png"),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    const apiCatalog = await page.request.get("/api/v1/catalog");
    expect(apiCatalog.ok()).toBe(true);
    expect(await apiCatalog.text()).toContain(entry.name);
    const login = await page.request.post("/api/auth/login", {
      headers: { origin },
      data: { email: admin.email, password },
    });
    expect(login.ok()).toBe(true);
    await page.goto("/components/" + modelId);
    await expect(
      page
        .getByRole("group", { name: "Действия с компонентом" })
        .getByRole("button", { name: "Редактировать", exact: true }),
    ).toBeVisible();
    await db.query("UPDATE users SET role='user' WHERE id=$1", [admin.id]);
    await page.goto("/components/" + modelId);
    await expect(
      page
        .getByRole("group", { name: "Действия с компонентом" })
        .getByRole("button", { name: "Редактировать", exact: true }),
    ).toHaveCount(0);
    // The existing wizard receives the same public catalog used by native clients.
    await page.goto("/account?tab=bikes");
    await page
      .getByRole("button", { name: "Добавить велосипед", exact: true })
      .click();
    const wizard = page.getByRole("dialog", {
      name: "Новый велосипед",
      exact: true,
    });
    await wizard
      .getByRole("button", { name: "Продолжить вручную", exact: true })
      .click();
    await wizard.getByLabel("Марка", { exact: true }).fill("Cube");
    await wizard.getByLabel("Модель", { exact: true }).fill("Travel");
    await wizard.getByLabel("Год", { exact: true }).fill("2024");
    await wizard
      .getByLabel("Категория велосипеда", { exact: true })
      .selectOption("road_gravel");
    await wizard.getByRole("button", { name: "Далее", exact: true }).click();
    // All supported model choices are delivered before a person has installed one.
    const site = await page.request.get("/api/site");
    expect((await site.json()).catalog.parts[entry.category]).toContain(
      entry.name,
    );
    await wizard.getByRole("button", { name: "Седло", exact: true }).click();
    await wizard
      .getByRole("combobox", { name: "Компонент", exact: true })
      .fill("Brooks B66");
    await wizard.getByRole("option", { name: entry.name, exact: true }).click();
    await wizard
      .getByRole("button", { name: "Сохранить велосипед", exact: true })
      .click();
    await expect(wizard).toHaveCount(0);
    const installed = (
      await db.query<{ model_id: string }>(
        "SELECT c.model_id FROM components c JOIN bikes b ON b.id=c.bike_id WHERE b.owner_id=$1 AND c.category=$2",
        [admin.id, entry.category],
      )
    ).rows;
    expect(installed).toEqual([{ model_id: modelId }]);
    const guest = await browser.newContext();
    try {
      const p = await guest.newPage();
      await p.goto(origin + "/components/" + modelId);
      await expect(
        p.getByRole("heading", { name: entry.name, exact: true }),
      ).toBeVisible();
    } finally {
      await guest.close();
    }
  } finally {
    await db.query("DELETE FROM component_seed_entries WHERE batch=$1", [
      batch.batch,
    ]);
    await db.query("DELETE FROM component_seed_batches WHERE batch=$1", [
      batch.batch,
    ]);
    await db.query("DELETE FROM users WHERE id=$1", [admin.id]);
    if (modelId) {
      await db.query("DELETE FROM component_model_names WHERE model_id=$1", [
        modelId,
      ]);
      await db.query("DELETE FROM component_model_urls WHERE model_id=$1", [
        modelId,
      ]);
      await db.query("DELETE FROM component_models WHERE id=$1", [modelId]);
    }
    for (const photo of media.values())
      await rm(path.join(process.env.UPLOAD_DIR || "uploads", photo.filename), {
        force: true,
      });
    await db.end();
  }
});
