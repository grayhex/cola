import { expect } from "@playwright/test";

// Step 1 of the new-bike wizard lets go only of a search that has run to its
// end for what stands in the fields (#366). For a model nothing is known about
// that is a search that finds nothing: it ends, and «Далее» opens, so the
// bike is filled in by hand. `text` is typed first when given.
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
    dialog.getByRole("button", { name: "Далее", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
}
