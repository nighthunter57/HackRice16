import { z } from 'zod';
import type { FinancialState, Transaction } from '../../types/finance';
import type { FinancialDataProvider } from './types';
import { centsSchema, utcDateSchema } from '../integrations/http';
export interface FinancialLoadResult {
  state: FinancialState;
  source: 'nessie' | 'demo';
  mode: 'live' | 'demo';
  warnings: string[];
  /** Includes today's posted events, already reflected in the balance; persist this collection to Tiger. */
  historyTransactions: Transaction[];
  merchants: { id: string; name: string; categories: string[] }[];
}
export abstract class NormalizedProvider implements FinancialDataProvider {
  abstract readonly dataSource: 'demo' | 'nessie';
  abstract loadFinancialState(): Promise<FinancialLoadResult>;
  async getUserFinancialState(userId: string) {
    const result = await this.loadFinancialState();
    if (result.state.userId !== userId) throw new Error('Financial provider user mismatch');
    return result.state;
  }
  async getFinancialState(userId: string) { return this.getUserFinancialState(userId); }
  async getAccounts(userId: string) { return (await this.getUserFinancialState(userId)).accounts; }
  async getTransactions(userId: string) {
    const result = await this.loadFinancialState();
    if (result.state.userId !== userId) throw new Error('Financial provider user mismatch');
    return result.historyTransactions;
  }
  async getBills(userId: string) { return (await this.getUserFinancialState(userId)).bills; }
  async getIncomeEvents(userId: string) { return (await this.getUserFinancialState(userId)).incomeEvents; }
}
export interface FinancialOptions {
  startDate?: string;
  horizonDays?: number;
  safetyBufferCents?: number;
}
export function settings(options: FinancialOptions) {
  return {
    startDate: utcDateSchema.parse(options.startDate ?? new Date().toISOString().slice(0, 10)),
    horizonDays: z.number().int().min(1).max(366).parse(options.horizonDays ?? 90),
    safetyBufferCents: centsSchema.nonnegative().parse(options.safetyBufferCents ?? 50_000),
  };
}
