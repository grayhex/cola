// Russian plural forms: 1 сборка, 2 сборки, 5 сборок, 11 сборок, 21 сборка.
export function plural(n, one, few, many) {
  const tens = Math.abs(n) % 100,
    units = tens % 10;
  if (tens > 10 && tens < 20) return many;
  if (units > 1 && units < 5) return few;
  if (units === 1) return one;
  return many;
}
