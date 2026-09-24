// Russian plural forms: 1 сборка, 2 сборки, 5 сборок; 11–14 take the last.
export function plural(n, one, few, many) {
  const tens = Math.abs(n) % 100,
    units = Math.abs(n) % 10;
  if (units === 1 && tens !== 11) return one;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
}
