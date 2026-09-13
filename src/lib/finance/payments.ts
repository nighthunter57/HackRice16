import type { Bill } from '../../types/finance';
import type { FinancialSettings } from '../../types/financial-settings';
import { financialSettingsSchema } from '../../types/financial-settings';
import { addDays, assertDate, occursOn } from './dates';

/** Preserve the recurrence anchor: Jan 31 must still recur on Mar 31. */
export function nextPaymentDate(payment: Bill, from: string): string | null {
  assertDate(from);
  if (payment.dueDate >= from) return payment.dueDate;
  if (payment.recurrence === 'once') return null;
  for (let offset = 0; offset <= 31; offset++) {
    const date = addDays(from, offset);
    if (occursOn(payment.dueDate, payment.recurrence, date)) return date;
  }
  return null;
}

export function savePayment(settings: FinancialSettings, payment: Bill): FinancialSettings {
  if (payment.amountCents <= 0) throw new Error('Enter an amount greater than zero.');
  return financialSettingsSchema.parse({...settings,
    bills: [...settings.bills.filter(item => item.id !== payment.id), payment],
    excludedBillIds: settings.excludedBillIds.filter(id => id !== payment.id),
  });
}

export function removePayment(settings: FinancialSettings, id: string): FinancialSettings {
  return financialSettingsSchema.parse({...settings,
    bills: settings.bills.filter(item => item.id !== id),
    excludedBillIds: [...new Set([...settings.excludedBillIds, id])],
  });
}
