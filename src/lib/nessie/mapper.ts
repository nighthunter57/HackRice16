import type { Account, Transaction } from '../../types/finance';
import type { NessieAccount, NessieTransfer } from './types';
import { dollarsSchema } from './types';
import { NessieError } from './errors';

export const toCents = (amount: number) => Math.round(dollarsSchema.parse(amount) * 100);
export const isPosted = (status: string) => status === 'completed' || status === 'executed';

export function mapAccount(account: NessieAccount, userId: string): Account | null {
  if (account.customer_id !== userId) throw new NessieError('invalid-response');
  if (account.type === 'Credit Card') return null;
  return { id: account._id, userId, name: account.nickname?.trim() || account.type, type: account.type === 'Checking' ? 'checking' : 'savings', balanceCents: toCents(account.balance) };
}

export function mapTransfer(transfer: NessieTransfer, accounts: Account[], userId: string, startDate: string): Transaction | null {
  if (transfer.status === 'cancelled') return null;
  const payer = accounts.some(account => account.id === transfer.payer_id);
  const payee = accounts.some(account => account.id === transfer.payee_id);
  if (!payer && !payee) throw new NessieError('invalid-response');
  const internal = payer && payee;
  if (!isPosted(transfer.status) && !payer && transfer.transaction_date < startDate) return null;
  const date = !isPosted(transfer.status) && transfer.transaction_date < startDate ? startDate : transfer.transaction_date;
  return { id: `nessie-transfer-${transfer._id}`, userId, accountId: payer ? transfer.payer_id : transfer.payee_id,
    timestamp: `${date}T00:00:00.000Z`, amountCents: (payer ? -1 : 1) * toCents(transfer.amount),
    merchant: transfer.description?.trim() || 'Bank transfer', category: 'transfer',
    eventType: internal ? 'transfer' : payer ? 'bill' : 'income' };
}
