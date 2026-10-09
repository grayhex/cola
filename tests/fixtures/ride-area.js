// The area field of the ride forms (#370): a search for a place, the chosen
// area and the ways to name it. `searchBox` is the question; the area is only
// what has been picked or named.
export const searchBox = (scope) =>
  scope.getByRole("searchbox", { name: /Найти место/ });
export const chosenArea = (scope) =>
  scope.getByRole("group", { name: "Выбранная область" });
export const areaName = (scope) =>
  chosenArea(scope).getByLabel("Название области");
// With an area chosen the search is folded away (#378): «Изменить место»
// brings it back, and the chosen area stays until another place is picked.
export async function showSearch(scope) {
  if (await searchBox(scope).count()) return searchBox(scope);
  await chosenArea(scope)
    .getByRole("button", { name: "Изменить место" })
    .click();
  return searchBox(scope);
}
// The name of the chosen area is edited in place: «Переименовать» opens it.
export async function showName(scope) {
  const rename = chosenArea(scope).getByRole("button", {
    name: "Переименовать",
  });
  if (await rename.count()) await rename.click();
  return areaName(scope);
}
// An area with no map: what is typed is taken as the name, on purpose.
export async function nameArea(scope, text) {
  await (await showSearch(scope)).fill(text);
  await scope
    .getByRole("button", {
      name: `Использовать «${text}» как подпись без карты`,
    })
    .click();
}
// A place from the search (the built-in list of test mode): name, centre and
// radius at once.
export async function pickPlace(scope, query, label) {
  await (await showSearch(scope)).fill(query);
  await scope
    .getByRole("list", { name: "Найденные места" })
    .getByRole("button", { name: new RegExp("^" + label) })
    .click();
}
