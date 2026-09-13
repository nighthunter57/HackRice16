import { z } from 'zod';
import { bankingDemoProfile } from '../../data/banking-demo';
export type { FinancialDataProvider } from '../financial-providers/types';
import { validateState } from '../finance/validation';
import { IntegrationError, safeReason, type FetchLike } from './http';
import { NormalizedProvider, settings, type FinancialLoadResult, type FinancialOptions } from '../financial-providers/base';
import { NessieFinancialDataProvider } from '../nessie/provider';
export { NessieFinancialDataProvider } from '../nessie/provider';
export type { FinancialLoadResult, FinancialOptions } from '../financial-providers/base';

export class DemoFinancialDataProvider extends NormalizedProvider {
  readonly dataSource = 'demo' as const;
  constructor(private readonly options: FinancialOptions = {}) { super(); }
  async loadFinancialState(): Promise<FinancialLoadResult> {
    const state = bankingDemoProfile();
    // Canonical fixture dates and amounts remain stable; callers may adjust simulation settings.
    const config = settings({ startDate: state.startDate, horizonDays: state.horizonDays, safetyBufferCents: state.safetyBufferCents, ...this.options });
    if(config.startDate!==state.startDate) throw new Error('Demo profile uses its pinned start date.');
    state.horizonDays = config.horizonDays;
    state.safetyBufferCents = config.safetyBufferCents;
    validateState(state);
    return { state, source: 'demo', mode: 'demo', warnings: ['Canonical seeded demonstration data; not connected financial information.'], historyTransactions: structuredClone(state.transactions), merchants: [] };
  }
}

export async function loadFinancialState(options: FinancialOptions & { mode?: 'auto' | 'live' | 'demo'; allowDemoFallback?: boolean; apiKey?: string; customerId?: string; baseUrl?: string; fetcher?: FetchLike } = {}): Promise<FinancialLoadResult> {
  const mode = options.mode ?? z.enum(['auto', 'live', 'demo']).parse(process.env.FINANCIAL_DATA_MODE ?? 'auto');
  const apiKey = options.apiKey ?? process.env.NESSIE_API_KEY;
  const customerId = options.customerId ?? process.env.NESSIE_CUSTOMER_ID;
  if (mode === 'demo' || (mode === 'auto' && !apiKey && !customerId)) return new DemoFinancialDataProvider(options).loadFinancialState();
  try {
    if (!apiKey || !customerId) throw new IntegrationError('Nessie', 'configuration');
    return await new NessieFinancialDataProvider({ ...options, apiKey, customerId, baseUrl: options.baseUrl ?? process.env.NESSIE_BASE_URL }).loadFinancialState();
  } catch (error) {
    if (!options.allowDemoFallback) throw error;
    const result = await new DemoFinancialDataProvider(options).loadFinancialState();
    result.warnings.push(`Explicit fallback: ${safeReason(error)}`);
    return result;
  }
}
