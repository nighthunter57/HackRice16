export function money(cents: number, decimals = false): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 }).format(cents / 100);
}
export function shortDate(date: string | null, long = false): string {
  if (!date) return 'Outside forecast';
  return new Intl.DateTimeFormat('en-US', { month: long ? 'long' : 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
export function dollarsToCents(input: string): number | null {
  const value = input.trim().replace(/^\$/, '');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
