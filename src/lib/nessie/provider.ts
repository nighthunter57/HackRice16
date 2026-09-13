import { z } from 'zod';
import type { Account, Bill, FinancialState, IncomeEvent, Transaction } from '../../types/finance';
import { NormalizedProvider, settings, type FinancialLoadResult, type FinancialOptions } from '../financial-providers/base';
import { validateState } from '../finance/validation';
import { IntegrationError, utcDateSchema, type FetchLike } from '../integrations/http';
import { createNessieClient } from './client';
import { customerSchema, accountSchema, purchaseSchema, movementSchema, billSchema, merchantSchema, transferSchema } from './types';
import { toCents as cents, isPosted as posted, mapAccount, mapTransfer } from './mapper';
import type { FinancialSchedule } from '../financial-providers/schedule';

export class NessieFinancialDataProvider extends NormalizedProvider {
  readonly dataSource = 'nessie' as const;
  constructor(private readonly options: FinancialOptions & { apiKey: string; customerId: string; baseUrl?: string; fetcher?: FetchLike; schedule?: FinancialSchedule }) { super(); }
  async loadFinancialState(): Promise<FinancialLoadResult> {
    const { apiKey, customerId, fetcher } = this.options;
    if (!apiKey.trim() || !customerId.trim()) throw new IntegrationError('Nessie', 'configuration');
    const get = createNessieClient({apiKey, baseUrl: this.options.baseUrl, fetcher}).nessieGet;
    const customer = await get(`/customers/${encodeURIComponent(customerId)}`, customerSchema);
    if (customer._id !== customerId) throw new IntegrationError('Nessie', 'invalid-response');
    const config = settings(this.options);
    const rawAccounts = await get(`/customers/${encodeURIComponent(customerId)}/accounts`, z.array(accountSchema));
    if (rawAccounts.some(account => account.customer_id !== customerId)) throw new IntegrationError('Nessie', 'invalid-response');
    const warnings = ['Nessie sandbox data; income recurrence and savings goals are not inferred.', 'Safety buffer is application configuration, not a bank fact.'];
    if (this.options.schedule) warnings.push('Configured internal schedule supplies additional goals and obligations.');
    if (this.options.schedule?.replaceNessieBills) warnings.push('Nessie bill listing is unavailable for this demo profile; known bills come from the configured internal schedule.');
    const accounts: Account[] = [];
    for (const account of rawAccounts) {
      if (account.type === 'Credit Card') { warnings.push('Credit card account omitted: domain supports liquid accounts only.'); continue; }
      const mapped = mapAccount(account, customerId);
      if (mapped) accounts.push(mapped);
    }
    if (!accounts.length) throw new IntegrationError('Nessie', 'invalid-response');
    const transactions: Transaction[] = [];
    const historyTransactions: Transaction[] = [];
    const bills: Bill[] = [];
    const incomeEvents: IncomeEvent[] = [];
    const merchants = new Map<string, { id: string; name: string; categories: string[] }>();
    const addTransaction = (transaction: Transaction, isPosted: boolean) => {
      if (isPosted) {
        historyTransactions.push(transaction);
        // Snapshot balances already include posted activity. The engine replays dates >= startDate.
        if (transaction.timestamp.slice(0, 10) < config.startDate) transactions.push(transaction);
      } else transactions.push(transaction);
    };
    const seenTransfers = new Set<string>();
    for (const account of accounts) {
      const prefix = `/accounts/${encodeURIComponent(account.id)}`;
      const resources = await Promise.allSettled([
        get(`${prefix}/purchases`, z.array(purchaseSchema)),
        get(`${prefix}/deposits`, z.array(movementSchema)),
        this.options.schedule?.replaceNessieBills ? Promise.resolve([]) : get(`${prefix}/bills`, z.array(billSchema)),
        get(`${prefix}/withdrawals`, z.array(movementSchema)),
        get(`${prefix}/transfers`, z.array(transferSchema)).catch(error=>{
          if (error instanceof IntegrationError && error.status === 404) return [];
          throw error;
        }),
      ]);
      const [purchases, deposits, rawBills, withdrawals, transfers] = resources;
      if (purchases.status === 'rejected') throw purchases.reason;
      if (deposits.status === 'rejected') throw deposits.reason;
      if (rawBills.status === 'rejected') throw rawBills.reason;
      if (withdrawals.status === 'rejected') throw withdrawals.reason;
      if (transfers.status === 'rejected') throw transfers.reason;
      for (const transfer of transfers.value) {
        if (seenTransfers.has(transfer._id)) continue;
        seenTransfers.add(transfer._id);
        const mapped = mapTransfer(transfer, accounts, customerId, config.startDate);
        if (mapped) {
          addTransaction(mapped, posted(transfer.status));
          // Tiger cash-flow analytics need both legs of an internal transfer.
          if (mapped.eventType === 'transfer') addTransaction({...mapped,id:`${mapped.id}-credit`,accountId:transfer.payee_id,amountCents:-mapped.amountCents},posted(transfer.status));
        }
      }
      for (const purchase of purchases.value) {
        if (purchase.status === 'cancelled') continue;
        if (purchase.payer_id && purchase.payer_id !== account.id) throw new IntegrationError('Nessie', 'invalid-response');
        let merchant = merchants.get(purchase.merchant_id);
        if (!merchant) {
          const raw = await get(`/merchants/${encodeURIComponent(purchase.merchant_id)}`, merchantSchema);
          if (raw._id !== purchase.merchant_id) throw new IntegrationError('Nessie', 'invalid-response');
          merchant = { id: raw._id, name: raw.name, categories: raw.category === undefined ? [] : typeof raw.category === 'string' ? [raw.category] : raw.category };
          merchants.set(merchant.id, merchant);
        }
        addTransaction({ id: `nessie-purchase-${purchase._id}`, userId: customerId, accountId: account.id, timestamp: `${posted(purchase.status) ? purchase.purchase_date : purchase.purchase_date < config.startDate ? config.startDate : purchase.purchase_date}T00:00:00.000Z`, amountCents: -cents(purchase.amount), category: merchant.categories[0] || 'uncategorized', merchant: merchant.name, eventType: 'discretionary' }, posted(purchase.status));
      }
      for (const deposit of deposits.value) {
        if (deposit.payee_id && deposit.payee_id !== account.id) throw new IntegrationError('Nessie', 'invalid-response');
        if (posted(deposit.status)) {
          addTransaction({ id: `nessie-deposit-${deposit._id}`, userId: customerId, accountId: account.id, timestamp: `${deposit.transaction_date}T00:00:00.000Z`, amountCents: cents(deposit.amount), category: 'deposit', merchant: deposit.description?.trim() || 'Deposit', eventType: 'income' }, true);
        } else if (deposit.status === 'pending' && deposit.transaction_date >= config.startDate) {
          incomeEvents.push({ id: `nessie-deposit-${deposit._id}`, userId: customerId, accountId:account.id, name: deposit.description?.trim() || 'Scheduled deposit', amountCents: cents(deposit.amount), expectedDate: deposit.transaction_date, recurrence: 'once' });
        } else if (deposit.status === 'pending') warnings.push('Overdue pending deposit excluded from projected income.');
      }
      for (const withdrawal of withdrawals.value) {
        if (withdrawal.payer_id && withdrawal.payer_id !== account.id) throw new IntegrationError('Nessie', 'invalid-response');
        if (withdrawal.status === 'cancelled') continue;
        const demoExpense=withdrawal.description?.startsWith('canibuyit-demo-expense:');
        addTransaction({ id: `nessie-withdrawal-${withdrawal._id}`, userId: customerId, accountId: account.id, timestamp: `${posted(withdrawal.status) ? withdrawal.transaction_date : withdrawal.transaction_date < config.startDate ? config.startDate : withdrawal.transaction_date}T00:00:00.000Z`, amountCents: -cents(withdrawal.amount), category: demoExpense?'transportation':'cash', merchant: demoExpense?'Auto Repair':withdrawal.description?.trim() || 'Cash withdrawal', eventType: demoExpense?'bill':'discretionary' }, posted(withdrawal.status));
      }
      for (const bill of rawBills.value) {
        if (bill.account_id && bill.account_id !== account.id) throw new IntegrationError('Nessie', 'invalid-response');
        if (bill.status === 'cancelled' || bill.status === 'completed') continue;
        let dueDate = bill.upcoming_payment_date ?? bill.payment_date;
        if (bill.status === 'recurring' && bill.recurring_date) {
          // Preserve the recurring day (including 29–31); the domain clamps short months.
          const start = new Date(`${config.startDate}T00:00:00Z`);
          for (let offset = 0; offset < 3; offset++) {
            const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - offset, 1));
            const candidate = `${first.toISOString().slice(0, 7)}-${String(bill.recurring_date).padStart(2, '0')}`;
            if (utcDateSchema.safeParse(candidate).success && candidate <= config.startDate) { dueDate = candidate; break; }
          }
        }
        if (!dueDate) throw new IntegrationError('Nessie', 'invalid-response');
        bills.push({ id: bill._id, userId: customerId, name: bill.nickname?.trim() || bill.payee, amountCents: cents(bill.payment_amount), dueDate: bill.status === 'pending' && dueDate < config.startDate ? config.startDate : dueDate, recurrence: bill.status === 'recurring' ? 'monthly' : 'once', mandatory: true });
      }
    }
    const schedule = this.options.schedule;
    if (schedule && schedule.userId !== customerId) throw new IntegrationError('Nessie','configuration');
    const state: FinancialState = { userId: customerId, ...config, accounts, transactions,
      bills:[...bills,...(schedule?.bills ?? [])], incomeEvents:[...incomeEvents,...(schedule?.incomeEvents ?? [])], goals:schedule?.goals ?? [] };
    validateState(state);
    return { state, source: 'nessie', mode: 'live', warnings, historyTransactions, merchants: [...merchants.values()] };
  }
}
