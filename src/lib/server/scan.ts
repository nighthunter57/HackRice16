import { recognizeProducts, type ProductInput } from '../integrations/gemini';
import { lookupBarcode } from '../integrations/product-search';
import { scanResultSchema, type ScanCandidate, type ScanResult } from '../../types/scan';

export async function scanProduct(input: ProductInput, dependencies = {
  recognize: recognizeProducts,
  lookup: lookupBarcode,
  catalogKey: process.env.UPCITEMDB_API_KEY,
}, options:{skipCatalog?:boolean;onTiming?:(timing:{geminiRequestMs:number;geminiParseMs:number})=>void} = {}): Promise<ScanResult> {
  const recognition = await dependencies.recognize(input,{onTiming:options.onTiming});
  const warnings: string[] = [];
  let catalog: ScanCandidate[] = [];
  if (!options.skipCatalog && recognition.barcode && dependencies.catalogKey) {
    try { catalog = await dependencies.lookup(recognition.barcode, dependencies.catalogKey); }
    catch { warnings.push('Catalog lookup is unavailable. You can still select a match and enter a price.'); }
  }
  const identities = [...recognition.candidates];
  // A supported family is useful even when the model cannot identify a generation.
  if (!identities.length && recognition.status !== 'NO_MATCH' && (recognition.confidence??0)>=0.5) {
    const name=recognition.productName?.trim() || recognition.productFamily?.trim();
    if(name) identities.push({productName:name.slice(0,120),brand:recognition.brand,category:recognition.category,confidence:recognition.confidence??0});
  }
  if ((recognition.detectedProducts?.length??0)>1) {
    for(const object of recognition.detectedProducts??[]) {
      if(object.confidence>=0.5 && !identities.some(item=>item.productName.toLowerCase()===object.label.toLowerCase()))
        identities.push({productName:object.label,confidence:object.confidence});
    }
  }
  const candidates: ScanCandidate[] = [...catalog, ...identities.map(candidate => ({
    ...candidate,category:candidate.category??'other',searchQuery:candidate.searchQuery??candidate.productName,evidence:candidate.evidence??'visual', imageUrl: null, priceCents: null, priceRange: null, priceSource: null,
  }))];
  const seen = new Set<string>();
  const ranked = candidates.sort((a, b) => b.confidence - a.confidence).filter(candidate => {
    const key = candidate.productName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 5).map(candidate => recognition.visiblePriceCents == null || (recognition.detectedProducts?.length??0)>1 ? candidate : {
    ...candidate, priceCents: recognition.visiblePriceCents, priceRange: null, priceSource: 'visible' as const,
  });
  const state = !ranked.length ? 'NO_MATCH' : ranked[0].evidence === 'barcode' ? 'BARCODE_MATCH' : ranked[0].evidence === 'text' ? 'TEXT_MATCH' : 'VISUAL_CANDIDATES';
  const status = !ranked.length ? 'NO_MATCH' : ranked.length>1 ? 'MULTIPLE_CANDIDATES' : ranked[0].priceCents === null ? 'PRODUCT_ONLY' : 'FULL_SUCCESS';
  return scanResultSchema.parse({ status, state, candidates: ranked, productFamily: recognition.productFamily ?? null, detectedProducts: recognition.detectedProducts ?? [],barcode:recognition.barcode??null,visiblePriceCents:recognition.visiblePriceCents??null,confidence:recognition.confidence??ranked[0]?.confidence??0,evidence:recognition.evidence??[], warnings });
}
