import { expect } from "@playwright/test";
// The theme switch sits in the header; phones keep it in the menu (#104).
// `use` gets the visible switch; a menu opened for it is closed afterwards.
export async function withThemeSwitch(page, use) {
  const name = { name: "Тёмная тема", exact: true };
  const header = page.locator(".nav-utilities").getByRole("switch", name);
  if (await header.isVisible()) return use(header);
  const dialog = page.getByRole("dialog", { name: "Меню ColaBike" });
  // A click before hydration opens nothing: retry until the menu is open.
  await expect(async () => {
    await page.getByRole("button", { name: "Открыть меню" }).click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  try {
    return await use(dialog.getByRole("switch", name));
  } finally {
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
}
