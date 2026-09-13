import { DemoFinancialDataProvider, NessieFinancialDataProvider, type FinancialOptions } from '../integrations/financial';
import type { FinancialDataProvider } from './types';
import { readFinancialSchedule } from './schedule';
export * from './types';
export { DemoFinancialDataProvider, NessieFinancialDataProvider };

/** Select once per request at the server boundary. Screens only consume normalized state. */
export function createFinancialProvider(options: FinancialOptions = {}, env: Record<string,string|undefined> = process.env): FinancialDataProvider {
  if (env.DEMO_MODE === 'true' || !env.NESSIE_API_KEY)
    return new DemoFinancialDataProvider(options);
  return new NessieFinancialDataProvider({...options,apiKey:env.NESSIE_API_KEY,customerId:env.NESSIE_CUSTOMER_ID??'',baseUrl:env.NESSIE_BASE_URL,schedule:readFinancialSchedule(env)});
}
