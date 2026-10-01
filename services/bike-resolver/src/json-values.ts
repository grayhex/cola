// External JSON stays unknown until the fields we consume have been checked.
export function jsonRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function jsonRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const record = jsonRecord(item);
    return record ? [record] : [];
  });
}
