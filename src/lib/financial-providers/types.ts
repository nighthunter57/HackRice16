import type { Account, Bill, FinancialState, IncomeEvent, Transaction } from '../../types/finance';
import type { FinancialLoadResult } from './base';

export type UserFinancialState = FinancialState;
export interface FinancialDataProvider {
  readonly dataSource: 'demo' | 'nessie';
  loadFinancialState(): Promise<FinancialLoadResult>;
  getFinancialState(userId: string): Promise<UserFinancialState>;
  getUserFinancialState(userId: string): Promise<UserFinancialState>;
  getAccounts(userId: string): Promise<Account[]>;
  getTransactions(userId: string): Promise<Transaction[]>;
  getBills(userId: string): Promise<Bill[]>;
  getIncomeEvents(userId: string): Promise<IncomeEvent[]>;
}
