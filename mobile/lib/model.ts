import { z } from "zod";
import { analyze } from "../../src/lib/finance";
import { injectRepair } from "../../src/data/demo-profile";
import { bankingDemoProfile } from "../../src/data/banking-demo";
import { dollarsToCents, shortDate } from "../../src/lib/display";
import { formatMoney } from "../../src/lib/finance/money";
import type { AnalysisResult, Purchase } from "../../src/types/finance";
import { financialStateSchema } from '../../src/types/financial-state-schema';
import { purchaseSchema } from '../../src/types/purchase';
export { purchaseSchema } from '../../src/types/purchase';

export { shortDate as dateLabel };
export const money = (cents: number | null) =>
  cents === null ? "Unavailable" : formatMoney(cents).replace(/\.00$/, "");
export function purchaseFromInput(
  name: string,
  price: string,
  category = "Other",
): Purchase {
  const cents = dollarsToCents(price);
  if (cents === null)
    throw new Error("Enter a USD price with up to two decimal places.");
  const parsed = purchaseSchema.safeParse({
    productName: name,
    priceCents: cents,
    category,
    purchaseType: "discretionary",
  });
  if (!parsed.success)
    throw new Error(
      "Use a product name of 1–120 characters, a category, and a price up to $99,999,999.99.",
    );
  return parsed.data;
}
export function verdict(analysis: AnalysisResult) {
  return analysis.today.verdict === "SAFE"
    ? "Safe"
    : analysis.safeDate
      ? "Wait"
      : "Not Safe Yet";
}
export function demoAnalysis(purchase: Purchase, repair: boolean) {
  const profile = repair ? injectRepair(bankingDemoProfile()) : bankingDemoProfile();
  return { profile, purchase, analysis: analyze(profile, purchase) };
}
export const historySchema = z
  .array(
    z.object({
      id: z.string(),
      purchase: purchaseSchema.extend({
        productName: z.string().trim().min(1).max(200),
        priceCents: z.number().int().safe().nonnegative(),
        category: z.string().max(100),
      }),
      checkedAt: z.string().datetime(),
      repair: z.boolean(),
      profile: financialStateSchema.optional(),
      dataSource: z.enum(['demo', 'nessie']).optional(),
      decision: z.enum(["Checked", "Wait for it", "Buy today", "Skip for now"]),
    }),
  )
  .max(50);
export type HistoryEntry = z.infer<typeof historySchema>[number];
export function newEntryId() { return `user-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
export const extractionSchema = z.object({
  product: z.object({
    productName: z.string().trim().min(1).max(200),
    priceCents: z.number().int().safe().nonnegative().nullable(),
    category: z.string().max(100).nullable(),
    purchaseType: z.enum(["essential", "discretionary", "unknown"]),
    confidence: z.number().min(0).max(1),
  }),
});
