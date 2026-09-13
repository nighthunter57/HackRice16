import { z } from 'zod';
import { financialStateSchema } from './financial-state-schema';

const id = z.string().min(1).max(300);
/** Device-owned planning overrides; account balances are never accepted here. */
export const financialSettingsSchema = z.object({
  userId: id,
  dataSource: z.enum(['demo', 'nessie']),
  accountIds: z.array(id).min(1).max(20),
  safetyBufferCents: z.number().int().min(0).max(9_999_999_999),
  bills: financialStateSchema.shape.bills.max(50),
  excludedBillIds: z.array(id).max(50),
  incomeEvents: financialStateSchema.shape.incomeEvents.max(50),
  excludedIncomeIds: z.array(id).max(50),
  goals: financialStateSchema.shape.goals.max(20),
}).strict().superRefine((value, ctx) => {
  for (const entries of [value.bills, value.incomeEvents, value.goals]) {
    if (entries.some(item => item.userId !== value.userId) || new Set(entries.map(item => item.id)).size !== entries.length)
      ctx.addIssue({code:'custom',message:'Planning entries must be unique and belong to this profile.'});
  }
  if (new Set(value.accountIds).size !== value.accountIds.length)
    ctx.addIssue({code:'custom',message:'Select each account once.'});
});
export type FinancialSettings = z.infer<typeof financialSettingsSchema>;
export const financialSettingsListSchema = z.array(financialSettingsSchema).max(20);
