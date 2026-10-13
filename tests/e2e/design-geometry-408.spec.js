import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { contrastRatio } from "../../lib/appearance.ts";
import { pageOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
async function theme(page, value) {
  if (page.url() === "about:blank") await page.goto("/");
  await page.evaluate((t) => localStorage.setItem("cola:theme", t), value);
}
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// Text ranges, not just document.scrollWidth: the original 320px collision
// occurred inside a shrunk flex label without widening the page.
async function stepGeometry(page) {
  return page.locator(".wizard-steps").evaluate((nav) => {
    const rect = (element) => element.getBoundingClientRect().toJSON();
    const steps = [...nav.querySelectorAll("button")].map((button) => {
      const label = button.querySelector("small");
      const range = document.createRange();
      range.selectNodeContents(label);
      return {
        box: rect(button),
        circle: rect(button.querySelector(":scope > span")),
        text: [...range.getClientRects()].map((r) => r.toJSON()),
      };
    });
    return steps.map((step, i) => ({
      ...step,
      escaped: step.text.some(
        (r) => r.x < step.box.x - 1 || r.right > step.box.right + 1,
      ),
      collision: step.text.some((r) =>
        steps.some(
          (other, j) =>
            j !== i &&
            r.left < other.circle.right &&
            r.right > other.circle.left &&
            r.top < other.circle.bottom &&
            r.bottom > other.circle.top,
        ),
      ),
    }));
  });
}

test("wizard step ranges fit at phone/tablet/desktop sizes, both themes and enlarged text", async ({
  page,
  browserName,
}, info) => {
  const registered = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Geometry fixture",
      email: randomUUID() + "@example.test",
      password: "geometry-fixture-408",
    },
  });
  expect(registered.status()).toBe(201);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const evidence = [];
  for (const mode of ["light", "dark"]) {
    await theme(page, mode);
    for (const width of browserName === "chromium"
      ? [320, 360, 393, 430, 768, 1024, 1440, 1920]
      : [320, 360, 393, 430, 768, 1024]) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      await page.goto("/account?tab=bikes&action=add");
      const dialog = page.getByRole("dialog", {
        name: "Новый велосипед",
        exact: true,
      });
      await dialog
        .getByRole("button", { name: "Продолжить вручную", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      const measured = await stepGeometry(page);
      expect(measured).toHaveLength(3);
      for (const step of measured) expect(step.text.length).toBeGreaterThan(0);
      expect(
        measured.some((s) => s.escaped || s.collision),
        JSON.stringify(measured),
      ).toBe(false);
      expect(await pageOverflow(page)).toBeNull();
      if (width <= 430)
        for (const step of measured)
          expect(step.box.height).toBeGreaterThanOrEqual(43.5);
      evidence.push({ width, mode, measured });
      if ([320, 393, 1440].includes(width))
        await page.screenshot({
          path: info.outputPath(`wizard-${width}-${mode}.png`),
        });
      if (width === 320) {
        // Actual CSS text enlargement, not a claim about browser zoom or OS keyboard.
        await page.locator(".wizard-steps small").evaluateAll((labels) => {
          const sizes = labels.map((el) =>
            parseFloat(getComputedStyle(el).fontSize),
          );
          labels.forEach((el, i) => {
            el.style.fontSize = sizes[i] * 2 + "px";
          });
        });
        const enlarged = await stepGeometry(page);
        expect(
          enlarged.some((s) => s.escaped || s.collision),
          JSON.stringify(enlarged),
        ).toBe(false);
        evidence.push({ width, mode, textScale: 2, measured: enlarged });
        await page.screenshot({
          path: info.outputPath(`wizard-320-${mode}-text-200.png`),
        });
      }
      if (width === 393) {
        const axe = await new AxeBuilder({ page }).withTags(tags).analyze();
        expect(axe.violations).toEqual([]);
      }
      await dialog
        .getByRole("button", { name: "Закрыть", exact: true })
        .click();
    }
  }
  await info.attach("step-boxes", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
});

test("drawer links and disclosure have separate 44px hit areas; filter apply and focus stay usable", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const evidence = [];
  for (const mode of ["light", "dark"]) {
    await theme(page, mode);
    for (const width of [320, 360, 393, 430, 768, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/bikes");
      const opener = page.getByRole("button", {
        name: "Открыть меню",
        exact: true,
      });
      await opener.click();
      const menu = page.getByRole("dialog", {
        name: "Меню ColaBike",
        exact: true,
      });
      const links = await menu.locator("nav a").evaluateAll((rows) =>
        rows.map((el) => ({
          label: el.textContent.trim(),
          box: el.getBoundingClientRect().toJSON(),
        })),
      );
      for (const link of links) {
        expect(link.box.height, link.label).toBeGreaterThanOrEqual(43.5);
        expect(link.box.width, link.label).toBeGreaterThanOrEqual(43.5);
      }
      const summary = menu.locator("[data-section=bikes] summary");
      const box = await summary.boundingBox();
      const anchor = await summary.locator("a").boundingBox();
      expect(
        box.x + box.width - anchor.x - anchor.width,
      ).toBeGreaterThanOrEqual(43.5);
      await summary.click({
        position: { x: box.width - 22, y: box.height / 2 },
      });
      await expect(
        menu.locator("[data-section=bikes] details"),
      ).not.toHaveAttribute("open", "");
      await expect(page).toHaveURL(origin + "/bikes");
      await summary.click({
        position: { x: box.width - 22, y: box.height / 2 },
      });
      await expect(
        menu.locator("[data-section=bikes] details"),
      ).toHaveAttribute("open", "");
      if ([320, 393].includes(width))
        await page.screenshot({
          path: info.outputPath(`menu-${width}-${mode}.png`),
        });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(opener).toBeFocused();
      const filter = page.getByRole("button", { name: /^Фильтры/ });
      await filter.click();
      const sheet = page.getByRole("dialog");
      const apply = sheet.getByRole("button", {
        name: "Применить",
        exact: true,
      });
      const applyBox = await apply.boundingBox();
      if (width <= 640 || info.project.name === "webkit-mobile")
        expect(applyBox.height).toBeGreaterThanOrEqual(43.5);
      await apply.scrollIntoViewIfNeeded();
      if ([320, 393].includes(width))
        await page.screenshot({
          path: info.outputPath(`filters-${width}-${mode}.png`),
        });
      await apply.click();
      await expect(sheet).toHaveCount(0);
      await expect(filter).toBeFocused();
      expect(await pageOverflow(page)).toBeNull();
      evidence.push({
        width,
        mode,
        links,
        summary: box,
        anchor,
        apply: applyBox,
      });
    }
  }
  await info.attach("hit-areas", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
});

test("about initials remain readable in themes; UI Kit renders system and custom-accent controls", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const mode of ["light", "dark"]) {
    await theme(page, mode);
    for (const width of [393, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/about");
      const initials = page
        .locator('[class*="about-module"][class*="avatar"]')
        .first();
      await expect(initials).toBeVisible();
      const colors = await initials.evaluate((el) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas color conversion unavailable");
        const hex = (color) => {
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return (
            "#" +
            [...context.getImageData(0, 0, 1, 1).data]
              .slice(0, 3)
              .map((n) => n.toString(16).padStart(2, "0"))
              .join("")
          );
        };
        const style = getComputedStyle(el);
        return {
          foreground: hex(style.color),
          background: hex(style.backgroundColor),
        };
      });
      expect(
        contrastRatio(colors.foreground, colors.background),
        JSON.stringify(colors),
      ).toBeGreaterThanOrEqual(4.5);
      expect(await pageOverflow(page)).toBeNull();
      const axe = await new AxeBuilder({ page }).withTags(tags).analyze();
      expect(axe.violations).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`about-${width}-${mode}.png`),
        fullPage: true,
      });
    }
  }
  const registration = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Kit fixture",
      email: randomUUID() + "@example.test",
      password: "kit-fixture-408",
    },
  });
  expect(registration.status()).toBe(201);
  const user = (await (await page.request.get("/api/me")).json()).user;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
  } finally {
    await db.end();
  }
  const overview = await (await page.request.get("/api/admin/overview")).json();
  const accent = "#FFFFFF";
  const response = await page.request.put("/api/admin/settings", {
    headers: { origin },
    data: {
      value: {
        ...overview.settings,
        appearance: { ...overview.settings.appearance, accent },
      },
      version: overview.settingsVersion,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  const changedVersion = (await response.json()).version;
  try {
    for (const mode of ["light", "dark", "system"]) {
      await theme(page, mode);
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
      for (const width of [393, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/admin/ui-kit");
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          mode === "system" ? "dark" : mode,
        );
        expect(await pageOverflow(page)).toBeNull();
        expect(
          await page
            .locator("html")
            .evaluate((html) =>
              getComputedStyle(html)
                .getPropertyValue("--accent")
                .trim()
                .toLowerCase(),
            ),
        ).toBe(accent.toLowerCase());
        const open = page
          .getByRole("button", { name: "Открыть диалог", exact: true })
          .first();
        await open.click();
        const demo = page.getByRole("dialog", {
          name: "Удалить запись?",
          exact: true,
        });
        await expect(demo).toBeVisible();
        await demo.getByRole("button", { name: "Отмена", exact: true }).click();
        await expect(demo).toHaveCount(0);
        await expect(open).toBeFocused();
        await page.screenshot({
          path: info.outputPath(`kit-${width}-${mode}-menus.png`),
        });
      }
    }
  } finally {
    const restored = await page.request.put("/api/admin/settings", {
      headers: { origin },
      data: { value: overview.settings, version: changedVersion },
    });
    expect(restored.status()).toBe(200);
  }
});
