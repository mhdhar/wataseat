// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sortData<T extends Record<string, any>>(
  data: T[],
  sort: string | null,
  order: string | null,
  getNestedValue?: (item: T, key: string) => unknown
): T[] {
  if (!sort) return data;

  const dir = order === 'desc' ? -1 : 1;

  return [...data].sort((a, b) => {
    const valA = getNestedValue ? getNestedValue(a, sort) : a[sort];
    const valB = getNestedValue ? getNestedValue(b, sort) : b[sort];

    if (valA == null && valB == null) return 0;
    if (valA == null) return 1;
    if (valB == null) return -1;

    if (typeof valA === 'number' && typeof valB === 'number') {
      return (valA - valB) * dir;
    }

    if (typeof valA === 'string' && typeof valB === 'string') {
      // Try date parse
      const dA = Date.parse(valA);
      const dB = Date.parse(valB);
      if (!isNaN(dA) && !isNaN(dB)) return (dA - dB) * dir;

      return valA.localeCompare(valB) * dir;
    }

    return 0;
  });
}
