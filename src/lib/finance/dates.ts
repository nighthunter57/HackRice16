import type { Recurrence } from '../../types/finance';

const DAY_MS = 86_400_000;

/** Accept UTC dates or canonical ISO UTC timestamps; reject local/ambiguous time. */
export function dateFromTimestamp(timestamp: string): string {
  if (typeof timestamp !== 'string') throw new TypeError('Timestamp must be a string.');
  if (timestamp.length === 10) { assertDate(timestamp); return timestamp; }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)) {
    throw new RangeError('Timestamp must be an ISO UTC timestamp.');
  }
  const date = timestamp.slice(0, 10);
  assertDate(date);
  const canonical = timestamp.length === 20 ? timestamp.replace('Z', '.000Z') : timestamp;
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== canonical) {
    throw new RangeError('Invalid UTC timestamp.');
  }
  return date;
}

export function assertDate(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) {
    throw new RangeError('Date must be a real UTC YYYY-MM-DD date (years 0001–9999).');
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new RangeError(`Invalid calendar date: ${value}.`);
  }
}

export function addDays(date: string, days: number): string {
  assertDate(date);
  if (!Number.isSafeInteger(days)) throw new RangeError('Day offset must be a safe integer.');
  const timestamp = Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS;
  if (!Number.isSafeInteger(timestamp)) throw new RangeError('Date offset exceeds supported range.');
  const result = new Date(timestamp).toISOString().slice(0, 10);
  assertDate(result);
  return result;
}

export function daysBetween(start: string, end: string): number {
  assertDate(start);
  assertDate(end);
  return (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS;
}

/** Monthly recurrence retains its original day, clamping only the current month. */
export function occursOn(anchor: string, recurrence: Recurrence, date: string): boolean {
  assertDate(anchor);
  assertDate(date);
  if (date < anchor) return false;
  const distance = daysBetween(anchor, date);
  switch (recurrence) {
    case 'once': return distance === 0;
    case 'weekly': return distance % 7 === 0;
    case 'biweekly': return distance % 14 === 0;
    case 'monthly': {
      const year = Number(date.slice(0, 4));
      const month = Number(date.slice(5, 7));
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const lastDay = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
      return Number(date.slice(8)) === Math.min(Number(anchor.slice(8)), lastDay);
    }
    default: throw new RangeError('Unsupported recurrence.');
  }
}
