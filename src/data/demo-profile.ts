import type { FinancialState, Purchase } from '../types/finance';
import { addDays } from '../lib/finance/dates';

export const demoPurchase: Purchase = {
  productName: 'Sony WH-1000XM6', priceCents: 44_900, category: 'Electronics', purchaseType: 'discretionary',
};

/** Fixed fixture; every call returns independent data. No outcome is hard-coded. */
export function demoProfile(): FinancialState {
  const userId = 'demo-user';
  const startDate = '2026-09-12';
  return {
    userId, startDate, horizonDays: 60, safetyBufferCents: 40_000,
    accounts: [
      { id: 'checking', userId, name: 'Everyday checking', type: 'checking', balanceCents: 185_000 },
      { id: 'savings', userId, name: 'Earmarked goal savings', type: 'savings', balanceCents: 190_000 },
    ],
    transactions: Array.from({ length: 30 }, (_, index) => ({
      id: `history-${index}`, userId, accountId: 'checking', timestamp: `${addDays(startDate, -30 + index)}T12:00:00.000Z`,
      amountCents: -3_000, merchant: 'Everyday purchases', category: 'Everyday', eventType: 'discretionary',
    })),
    bills: [
      { id: 'rent', userId, name: 'Rent', amountCents: 110_000, dueDate: '2026-09-13', recurrence: 'monthly', mandatory: true },
      { id: 'phone', userId, name: 'Phone', amountCents: 8_000, dueDate: '2026-09-14', recurrence: 'monthly', mandatory: true },
    ],
    incomeEvents: [
      { id: 'paycheck', userId, name: 'Weekly paycheck', amountCents: 90_000, expectedDate: '2026-09-18', recurrence: 'weekly' },
    ],
    goals: [
      { id: 'japan', userId, name: 'Japan trip', targetCents: 300_000, savedCents: 190_000, maxDelayDays: 14 },
    ],
  };
}

/** One future bill, never a simultaneous transaction or opening balance debit. */
export function injectRepair(state: FinancialState): FinancialState {
  const copy = structuredClone(state);
  if (!copy.bills.some(bill => bill.id === 'unexpected-repair')) {
    copy.bills.push({ id: 'unexpected-repair', userId: state.userId, name: 'Unexpected car repair',
      amountCents: 43_000, dueDate: addDays(state.startDate, 8), recurrence: 'once', mandatory: true });
  }
  return copy;
}
