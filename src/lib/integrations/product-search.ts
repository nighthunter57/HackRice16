import { z } from 'zod';
import { requestJson, type FetchLike } from './http';
import type { ScanCandidate } from '../../types/scan';

const catalogSchema = z.object({ code: z.literal('OK'), items: z.array(z.object({
  title: z.string().min(1).max(120), brand: z.string().max(100).optional(), category: z.string().optional(),
  images: z.array(z.string()).optional(),
  offers: z.array(z.object({ currency: z.string(), price: z.number().finite().nonnegative(), availability: z.string().optional() })).optional(),
})) });

export async function lookupBarcode(barcode: string, apiKey: string, fetcher?: FetchLike): Promise<ScanCandidate[]> {
  // Arbitrary QR URLs are never fetched. Only UPC/EAN digit sequences reach the catalog.
  if (!/^(?:\d{8}|\d{12,14})$/.test(barcode)) return [];
  const url = new URL('https://api.upcitemdb.com/prod/v1/lookup');
  url.searchParams.set('upc', barcode);
  const data = await requestJson('UPCitemdb', url, catalogSchema, { headers: { user_key: apiKey, key_type: '3scale' } }, fetcher);
  return data.items.slice(0, 5).map(item => {
    const prices = (item.offers ?? []).filter(o => (o.currency === 'USD' || o.currency === '') && o.availability !== 'Out of Stock')
      .map(o => Math.round(o.price * 100)).filter(p => Number.isSafeInteger(p) && p > 0);
    const minCents = prices.length ? Math.min(...prices) : null;
    const maxCents = prices.length ? Math.max(...prices) : null;
    return {
      productName: item.title, brand: item.brand ?? null, model: null, category: item.category?.slice(0, 100) ?? 'other',
      confidence: 0.95, searchQuery: item.title, evidence: 'barcode',
      imageUrl: item.images?.find(url => z.url().safeParse(url).success && url.startsWith('https://')) ?? null,
      priceCents: minCents === maxCents ? minCents : null,
      priceRange: minCents !== null && maxCents !== null ? { minCents, maxCents } : null,
      priceSource: prices.length ? 'catalog' : null,
    };
  });
}
