import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { financialStateSchema } from '../../types/financial-state-schema';
import { IntegrationError } from '../integrations/http';

const scheduleSchema = z.object({
  userId: z.string().min(1), replaceNessieBills: z.boolean().default(false),
  bills: financialStateSchema.shape.bills,
  incomeEvents: financialStateSchema.shape.incomeEvents,
  goals: financialStateSchema.shape.goals,
}).strict();
export type FinancialSchedule = z.infer<typeof scheduleSchema>;

export function readFinancialSchedule(env: Record<string,string|undefined>): FinancialSchedule | undefined {
  if (!env.NESSIE_SCHEDULE_JSON && !env.NESSIE_SCHEDULE_PATH) return undefined;
  try {
    const raw = env.NESSIE_SCHEDULE_JSON ?? (env.NESSIE_SCHEDULE_PATH ? readFileSync(env.NESSIE_SCHEDULE_PATH, 'utf8') : '');
    const schedule = scheduleSchema.parse(JSON.parse(raw));
    if (schedule.userId !== env.NESSIE_CUSTOMER_ID || [...schedule.bills,...schedule.incomeEvents,...schedule.goals].some(item=>item.userId!==schedule.userId)) throw new Error();
    return schedule;
  } catch { throw new IntegrationError('Nessie','configuration'); }
}
