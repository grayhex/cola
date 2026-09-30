// Motion expects a numeric bezier tuple, not the CSS cubic-bezier() string.
export function cssBezier(
  value: string,
): [number, number, number, number] | undefined {
  const match = /^cubic-bezier\(([^)]+)\)$/.exec(value.trim());
  if (!match) return undefined;
  if (match[1].split(",").some((part) => !part.trim())) return undefined;
  const values = match[1].split(",").map((part) => Number(part.trim()));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value)))
    return undefined;
  const [x1, y1, x2, y2] = values;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return undefined;
  return [x1, y1, x2, y2];
}
