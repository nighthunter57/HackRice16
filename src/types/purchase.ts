import { z } from 'zod';

export const purchaseSchema = z.object({
  productName: z.string().trim().min(1).max(120),
  priceCents: z.number().int().safe().min(0).max(9_999_999_999),
  category: z.string().min(1).max(100),
  purchaseType: z.enum(['essential', 'discretionary', 'unknown']),
}).strict();
