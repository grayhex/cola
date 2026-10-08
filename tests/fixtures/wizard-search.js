import { expect } from "@playwright/test";

// The search of the new-bike wizard is optional (#370). `searchWizard` types
// `text` when given, runs the search and waits until it has ended — the button
// then offers to repeat it — and stays on the first step; `leaveSearch` takes
// the step's one forward button, «Далее» after a found bike and «Продолжить
// вручную» in every other case. For a model nothing is known about the search
// ends without a result, so the bike is filled in by hand.
export async function searchWizard(dialog, text) {
  const field = dialog.getByLabel("Модель, год и комплектация", {
    exact: true,
  });
  if (text !== undefined) await field.fill(text);
  await dialog
    .getByRole("button", {
      name: /^(Найти комплектацию|Повторить автоматический поиск)/,
    })
    .click();
  await expect(
    dialog.getByRole("button", { name: /^Повторить автоматический поиск/ }),
  ).toBeVisible({ timeout: 60_000 });
}
export function leaveSearch(dialog) {
  return dialog
    .getByRole("button", { name: /^(Далее|Продолжить вручную)$/ })
    .click();
}
