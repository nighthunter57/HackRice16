import type { FinancialState, Purchase } from '../../types/finance';
import { addDays, assertDate, dateFromTimestamp } from './dates';
import { addCents, assertCents } from './money';

function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected a financial data object.');
  }
}

function text(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be nonempty text.`);
}

function nonnegative(value: unknown, label: string): asserts value is number {
  assertCents(value, label);
  if (value < 0) throw new RangeError(`${label} cannot be negative.`);
}

function recurrence(value: unknown): void {
  if (!['once', 'weekly', 'biweekly', 'monthly'].includes(String(value))) {
    throw new RangeError('Recurrence must be once, weekly, biweekly, or monthly.');
  }
}

function entities(value: unknown): asserts value is Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError('Financial collections must be arrays.');
  const ids = new Set<string>();
  for (const item of value) {
    record(item);
    text(item.id, 'ID');
    if (typeof item.id !== 'string') throw new TypeError('ID must be text.');
    if (ids.has(item.id)) throw new RangeError(`Duplicate ID: ${item.id}.`);
    ids.add(item.id);
  }
}

export function validateState(state: FinancialState): void {
  record(state);
  text(state.userId, 'User ID');
  assertDate(state.startDate);
  if (!Number.isSafeInteger(state.horizonDays) || state.horizonDays < 1 || state.horizonDays > 366) {
    throw new RangeError('Forecast horizon must be an integer between 1 and 366 days.');
  }
  addDays(state.startDate, state.horizonDays - 1);
  nonnegative(state.safetyBufferCents, 'Safety buffer');
  entities(state.accounts);
  entities(state.transactions);
  entities(state.bills);
  entities(state.incomeEvents);
  entities(state.goals);
  for (const collection of [state.accounts, state.transactions, state.bills, state.incomeEvents, state.goals]) {
    for (const entity of collection) {
      if (entity.userId !== state.userId) throw new RangeError('Financial entity belongs to a different user.');
    }
  }
  let assets = 0;
  for (const account of state.accounts) {
    text(account.name, 'Account name');
    if (account.type !== 'checking' && account.type !== 'savings') throw new RangeError('Unsupported account type.');
    assertCents(account.balanceCents, 'Account balance');
    assets = addCents(assets, account.balanceCents);
  }
  for (const transaction of state.transactions) {
    dateFromTimestamp(transaction.timestamp);
    text(transaction.merchant, 'Transaction merchant');
    if (!state.accounts.some(account => account.id === transaction.accountId)) throw new RangeError('Unknown transaction account.');
    assertCents(transaction.amountCents, 'Transaction amount');
    text(transaction.category, 'Transaction category');
    if (!['discretionary', 'income', 'bill', 'transfer'].includes(transaction.eventType)) {
      throw new RangeError('Unsupported transaction kind.');
    }
  }
  for (const bill of state.bills) {
    text(bill.name, 'Bill name');
    nonnegative(bill.amountCents, 'Bill amount');
    assertDate(bill.dueDate);
    recurrence(bill.recurrence);
    if (bill.mandatory !== undefined && typeof bill.mandatory !== 'boolean') throw new TypeError('Bill mandatory flag must be boolean.');
  }
  for (const income of state.incomeEvents) {
    if (income.name !== undefined) text(income.name, 'Income name');
    nonnegative(income.amountCents, 'Income amount');
    assertDate(income.expectedDate);
    recurrence(income.recurrence ?? 'once');
  }
  let reserved = 0;
  for (const goal of state.goals) {
    text(goal.name, 'Goal name');
    nonnegative(goal.targetCents, 'Goal target');
    nonnegative(goal.savedCents, 'Goal savings');
    if (goal.savedCents > goal.targetCents) throw new RangeError('Goal savings cannot exceed its target.');
    reserved = addCents(reserved, goal.savedCents);
    if (goal.deadline !== undefined) assertDate(goal.deadline);
    if (goal.maxDelayDays !== undefined) nonnegative(goal.maxDelayDays, 'Goal delay tolerance');
  }
  if (reserved > 0 && reserved > assets) throw new RangeError('Earmarked goal savings exceed existing assets.');
}

export function validatePurchase(purchase: Purchase): void {
  record(purchase);
  text(purchase.productName, 'Product name');
  text(purchase.category, 'Purchase category');
  nonnegative(purchase.priceCents, 'Purchase price');
  if (!['essential', 'discretionary', 'unknown'].includes(purchase.purchaseType)) {
    throw new RangeError('Purchase type must be essential, discretionary, or unknown.');
  }
}
