import { z } from 'zod';
import { assertDate } from '../lib/finance/dates';
import { validateState } from '../lib/finance/validation';
const cents=z.number().int().safe(), text=z.string().min(1).max(300);
const date=z.string().refine(v=>{try{assertDate(v);return true;}catch{return false;}});
const recurrence=z.enum(['once','weekly','biweekly','monthly']);
export const financialStateSchema=z.object({
  userId:text,startDate:date,horizonDays:z.number().int().min(1).max(366),safetyBufferCents:cents.nonnegative(),
  accounts:z.array(z.object({id:text,userId:text,name:text,type:z.enum(['checking','savings']),balanceCents:cents})),
  transactions:z.array(z.object({id:text,userId:text,accountId:text,timestamp:z.string(),amountCents:cents,category:text,merchant:text,eventType:z.enum(['discretionary','income','bill','transfer'])})),
  bills:z.array(z.object({id:text,userId:text,name:text,amountCents:cents.nonnegative(),dueDate:date,recurrence,mandatory:z.boolean().optional()})),
  incomeEvents:z.array(z.object({id:text,userId:text,accountId:text.optional(),name:text.optional(),amountCents:cents.nonnegative(),expectedDate:date,recurrence:recurrence.optional()})),
  goals:z.array(z.object({id:text,userId:text,name:text,targetCents:cents.nonnegative(),savedCents:cents.nonnegative(),deadline:date.optional(),maxDelayDays:z.number().int().nonnegative().optional()})),
}).superRefine((value,context)=>{try{validateState(value);}catch{context.addIssue({code:'custom',message:'Invalid financial state'});}});
