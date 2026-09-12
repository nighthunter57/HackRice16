export function assertCents(value: unknown, label = 'Amount'): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be safe integer cents.`);
  }
}

export function addCents(left: number, right: number): number {
  assertCents(left);
  assertCents(right);
  const result = left + right;
  assertCents(result, 'Calculated amount');
  return result;
}

/** Formats without converting large integer cents to an imprecise dollar float. */
export function formatMoney(cents: number): string {
  assertCents(cents);
  const magnitude = BigInt(cents < 0 ? -cents : cents);
  const dollars = (magnitude / 100n).toLocaleString('en-US');
  return `${cents < 0 ? '-' : ''}$${dollars}.${String(magnitude % 100n).padStart(2, '0')}`;
}

export const formatCents = formatMoney;
