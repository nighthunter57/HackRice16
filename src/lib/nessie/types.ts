import { z } from 'zod';
import { utcDateSchema } from '../integrations/http';

export const identifier = z.string().trim().min(1);
export const dollarsSchema = z.number().finite().refine(value => Number.isSafeInteger(Math.round(value * 100)), 'Amount exceeds safe cents range');
export const statusSchema = z.enum(['pending', 'completed', 'cancelled', 'executed']);
export const customerSchema = z.object({ _id: identifier, first_name: identifier, last_name: identifier });
export const accountSchema = z.object({ _id: identifier, customer_id: identifier, nickname: z.string().optional(), type: z.enum(['Checking', 'Savings', 'Credit Card']), balance: dollarsSchema });
export const purchaseSchema = z.object({ _id: identifier, merchant_id: identifier, purchase_date: utcDateSchema, amount: dollarsSchema.nonnegative(), status: statusSchema, description: z.string().optional(), payer_id: identifier.optional() });
export const movementSchema = z.object({ _id: identifier, transaction_date: utcDateSchema, amount: dollarsSchema.nonnegative(), status: statusSchema, description: z.string().optional(), payer_id: identifier.optional(), payee_id: identifier.optional() });
export const transferSchema = movementSchema.extend({ payer_id: identifier, payee_id: identifier });
export const billSchema = z.object({ _id: identifier, account_id: identifier.optional(), status: z.enum(['pending', 'cancelled', 'completed', 'recurring']), payee: identifier, nickname: z.string().optional(), payment_date: utcDateSchema.nullish(), upcoming_payment_date: utcDateSchema.nullish(), recurring_date: z.number().int().min(1).max(31).nullish(), payment_amount: dollarsSchema.nonnegative() });
export const merchantSchema = z.object({ _id: identifier, name: identifier, category: z.union([z.string(), z.array(z.string())]).optional() });
export const createdSchema = z.object({ code: z.literal(201), objectCreated: z.object({ _id: identifier }).passthrough() });
export type NessieAccount = z.infer<typeof accountSchema>;
export type NessieTransfer = z.infer<typeof transferSchema>;
