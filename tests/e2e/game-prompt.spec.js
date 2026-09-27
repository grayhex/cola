import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { gameImagePromptLimit } from "../../lib/game-prompt-validation.js";

const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("admin image prompt saves real plain text, survives reload and clears independently in both themes", async ({ page, isMobile }, info) => {
  const email = `prompt-${randomUUID()}@example.test`;
  expect((await registerVerified(page.request, {
    headers: { origin }, data: { ...testConsents, name: "Prompt editor", email, password: "prompt-editor-test-123" },
  })).status()).toBe(201);
  const q = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await q.connect();
  const original = (await q.query("SELECT value FROM gamification_settings WHERE id=1")).rows[0].value;
  const rules = (await q.query("SELECT * FROM game_rules ORDER BY key")).rows;
  try {
    await q.query("UPDATE users SET role='admin' WHERE email=$1", [email]);
    await q.query("UPDATE gamification_settings SET value=value-'imagePrompt' WHERE id=1");
    async function openEditor() {
      await page.goto("/admin");
      await page.getByRole("tab", { name: "Механики", exact: true }).click();
      await page.getByRole("button", { name: "Награды и рекорды", exact: true }).click();
      await page.locator('.game-image-prompt > summary').click();
    }
    const editor = page.locator('.game-image-prompt');
    const input = editor.getByRole("textbox", { name: "Prompt / гайд для генерации изображений", exact: true });
    const save = editor.getByRole("button", { name: "Сохранить гайд", exact: true });
    await openEditor();
    await expect(input).toHaveValue("");
    await expect(editor).toContainText("Гайд пока не задан.");
    await expect(input).toHaveAttribute("maxlength", String(gameImagePromptLimit));
    await expect(save).toBeDisabled();
    const prompt = '<script>window.promptExecuted = true</script>\nИллюстрации ColaBike: графит, оранжевый акцент 🏆';
    await input.fill(prompt);
    await save.click();
    await expect(editor.getByRole("status")).toHaveText("Гайд сохранён");
    await expect(save).toBeDisabled();
    await openEditor();
    await expect(input).toHaveValue(prompt);
    expect(await page.evaluate(() => window.promptExecuted)).toBeUndefined();
    await expect(editor.locator("script")).toHaveCount(0);
    expect((await (await page.request.get("/api/game/admin/image-prompt")).json()).prompt).toBe(prompt);
    await input.fill("Несохранённое изменение");
    await editor.getByRole("button", { name: "Отменить изменения гайда", exact: true }).click();
    await expect(input).toHaveValue(prompt);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => localStorage.setItem("cola:theme", value), theme);
      await openEditor();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(input).toHaveValue(prompt);
      for (const width of isMobile ? [390, 360] : [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const result = await new AxeBuilder({ page }).include(".game-image-prompt").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(result.violations).toEqual([]);
        await editor.screenshot({ path: info.outputPath(`game-prompt-${theme}-${width}.png`) });
      }
    }
    await input.fill("");
    await save.click();
    await expect(editor.getByRole("status")).toHaveText("Гайд удалён");
    await openEditor();
    await expect(input).toHaveValue("");
    expect((await q.query("SELECT * FROM game_rules ORDER BY key")).rows).toEqual(rules);
  } finally {
    await q.query("UPDATE gamification_settings SET value=$1 WHERE id=1", [original]);
    await q.query("DELETE FROM users WHERE email=$1", [email]);
    await q.end();
  }
});
