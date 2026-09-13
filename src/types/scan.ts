import { z } from 'zod';

const cents = z.number().int().safe().nonnegative();
export const recognitionCandidateSchema = z.object({
  productName: z.string().trim().min(1).max(120),
  brand: z.string().max(100).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  confidence: z.number().min(0).max(1),
  searchQuery: z.string().trim().min(1).max(200).optional(),
  evidence: z.enum(['barcode', 'text', 'visual']).optional(),
  reason: z.string().trim().max(300).optional(),
}).strict();
export const recognitionSchema = z.object({
  status: z.enum(['FULL_SUCCESS','PRODUCT_ONLY','MULTIPLE_CANDIDATES','NO_MATCH']).optional(),
  barcode: z.string().max(200).nullable().optional().default(null),
  visibleText: z.string().max(1500).optional(),
  productFamily: z.string().max(200).nullable().optional(),
  brand: z.string().max(100).nullable().optional(),
  productName: z.string().max(200).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  visiblePriceCents: cents.nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.array(z.string().trim().max(300)).max(8).optional(),
  detectedProducts: z.array(z.object({label:z.string().trim().min(1).max(120),confidence:z.number().min(0).max(1)}).strict()).max(8).optional(),
  candidates: z.array(recognitionCandidateSchema).max(5),
}).strict();
export const scanCandidateSchema = recognitionCandidateSchema.extend({
  category:z.string().max(100),
  searchQuery:z.string().trim().min(1).max(200),
  evidence:z.enum(['barcode','text','visual']),
  imageUrl: z.url().refine(value => value.startsWith('https://')).nullable(),
  priceCents: cents.nullable(),
  priceRange: z.object({ minCents: cents, maxCents: cents }).refine(v => v.minCents <= v.maxCents).nullable(),
  priceSource: z.enum(['visible', 'catalog', 'marketplace']).nullable(),
});
export const scanStateSchema = z.enum(['BARCODE_MATCH', 'TEXT_MATCH', 'VISUAL_CANDIDATES', 'PRODUCT_FOUND_PRICE_MISSING', 'FULL_SUCCESS', 'NO_MATCH']);
export const scanResultSchema = z.object({
  status: z.enum(['NO_MATCH','PRODUCT_ONLY','MULTIPLE_CANDIDATES','FULL_SUCCESS']),
  state: scanStateSchema,
  productFamily: z.string().nullable(),
  detectedProducts: z.array(z.object({label:z.string(),confidence:z.number().min(0).max(1)}).strict()).default([]),
  barcode:z.string().nullable().optional(),
  visiblePriceCents:cents.nullable().optional(),
  confidence:z.number().min(0).max(1).optional(),
  evidence:z.array(z.string()).optional(),
  timings:z.object({backendReceiveMs:z.number().nonnegative(),geminiRequestMs:z.number().nonnegative(),geminiParseMs:z.number().nonnegative(),totalRecognitionMs:z.number().nonnegative(),cacheHit:z.boolean()}).optional(),
  candidates: z.array(scanCandidateSchema).max(5),
  warnings: z.array(z.string()),
});
export const scanFailureSchema = z.object({
  status:z.enum(['NETWORK_ERROR','BACKEND_ERROR','GEMINI_ERROR']),
  code:z.string(),error:z.string(),requestId:z.string().optional(),
});
export type ScanCandidate = z.infer<typeof scanCandidateSchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
export function mergeCatalogMatches(current:ScanResult,catalog:ScanCandidate[],message?:string):ScanResult{
  const candidates=current.candidates.map(item=>{
    const match=catalog.find(other=>other.productName.toLowerCase()===item.productName.toLowerCase());
    return match && item.priceCents===null && item.priceRange===null ? {...item,priceCents:match.priceCents,priceRange:match.priceRange,priceSource:match.priceSource} : item;
  });
  candidates.push(...catalog.filter(item=>!candidates.some(old=>old.productName.toLowerCase()===item.productName.toLowerCase())));
  const selected=candidates.slice(0,5);
  return {...current,candidates:selected,state:!selected.length?'NO_MATCH':selected[0].evidence==='barcode'?'BARCODE_MATCH':selected[0].evidence==='text'?'TEXT_MATCH':'VISUAL_CANDIDATES',status:!selected.length?'NO_MATCH':selected.length>1?'MULTIPLE_CANDIDATES':selected[0].priceCents===null?'PRODUCT_ONLY':'FULL_SUCCESS',warnings:message?[message]:[]};
}
// Transport status means extraction completeness; UI state still requires explicit price confirmation.
export function selectedScanState(candidate: ScanCandidate, confirmed: boolean): z.infer<typeof scanStateSchema> {
  if (confirmed) return 'FULL_SUCCESS';
  return candidate.priceCents === null ? 'PRODUCT_FOUND_PRICE_MISSING' : candidate.evidence === 'barcode' ? 'BARCODE_MATCH' : candidate.evidence === 'text' ? 'TEXT_MATCH' : 'VISUAL_CANDIDATES';
}
