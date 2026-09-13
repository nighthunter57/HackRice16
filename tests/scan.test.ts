import assert from 'node:assert/strict';
import test from 'node:test';
import { recognizeProducts } from '../src/lib/integrations/gemini';
import { lookupBarcode } from '../src/lib/integrations/product-search';
import { scanProduct } from '../src/lib/server/scan';
import { recognitionSchema, selectedScanState } from '../src/types/scan';

const candidate = { productName: 'Wireless headphones', brand: null, category: 'electronics', confidence: 0.6, searchQuery: 'wireless over ear headphones', evidence: 'visual' as const };
const recognition = { barcode: null, visibleText: '', productFamily: 'Headphones', visiblePriceCents: null, candidates: [candidate] };
const json = (body: unknown) => new Response(JSON.stringify(body));

test('a bare product photo succeeds with visual candidates and no price', async () => {
  const result = await scanProduct({ imageBase64: 'YWJj', mimeType: 'image/jpeg' }, { recognize: async () => recognition, lookup: async () => [], catalogKey: undefined });
  assert.equal(result.state, 'VISUAL_CANDIDATES');
  assert.equal(result.candidates[0].priceCents, null);
  assert.equal(selectedScanState(result.candidates[0], false), 'PRODUCT_FOUND_PRICE_MISSING');
  assert.equal(selectedScanState(result.candidates[0], true), 'FULL_SUCCESS');
});

test('ranks and deduplicates candidates; visible price takes precedence over catalog', async () => {
  const result = await scanProduct({ text: 'Headphones' }, {
    recognize: async () => ({ ...recognition, barcode: '123456789012', visiblePriceCents: 2499, candidates: [candidate, { ...candidate, productName: 'Other headphones', confidence: 0.8 }] }),
    lookup: async () => [{ ...candidate, confidence: 0.95, evidence: 'barcode', imageUrl: null, priceCents: 9999, priceRange: null, priceSource: 'catalog' }], catalogKey: 'test',
  });
  assert.equal(result.state, 'BARCODE_MATCH');
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].priceCents, 2499);
  assert.equal(result.candidates[0].priceSource, 'visible');
});

test('empty recognition is NO_MATCH; catalog outage retains successful recognition', async () => {
  const dependencies = { recognize: async () => ({ ...recognition, barcode: '123456789012' }), lookup: async () => { throw new Error('private credentials'); }, catalogKey: 'test' };
  const result = await scanProduct({ text: 'headphones' }, dependencies);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.ok(!JSON.stringify(result).includes('private credentials'));
  const empty = await scanProduct({ text: 'unknown' }, { ...dependencies, recognize: async () => ({ ...recognition, candidates: [] }) });
  assert.equal(empty.state, 'NO_MATCH');
});

test('Gemini validates structured candidates and rejects model-added prices and malformed responses', async () => {
  const run = (value: unknown) => recognizeProducts({ imageBase64: 'YWJj', mimeType: 'image/jpeg' }, { apiKey: 'test', fetcher: async (_url, init) => {
    assert.ok(String(init?.body).includes('Never estimate'));
    return json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
  } });
  assert.deepEqual(await run(recognition), recognition);
  await assert.rejects(run({ ...recognition, candidates: [{ ...candidate, priceCents: 2999 }] }), /invalid-response/);
  await assert.rejects(run({ ...recognition, visiblePriceCents: -1 }), /invalid-response/);
  assert.equal(recognitionSchema.safeParse({ ...recognition, candidates: Array(6).fill(candidate) }).success, false);
  await assert.rejects(recognizeProducts({ text: 'headphones' }, { apiKey: 'test', fetcher: async () => { throw new Error('secret'); } }), /network/);
});

test('catalog prices are USD offer ranges, never historical prices or foreign currency; QR URLs are not followed', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return json({ code: 'OK', items: [{ title: 'Headphones', lowest_recorded_price: 1, offers: [{ currency: 'USD', price: 29.99 }, { currency: '', price: 39.99 }, { currency: 'EUR', price: 1 }] }] }); };
  const products = await lookupBarcode('123456789012', 'test', fetcher);
  assert.deepEqual(products[0].priceRange, { minCents: 2999, maxCents: 3999 });
  assert.equal(products[0].priceCents, null);
  assert.deepEqual(await lookupBarcode('https://untrusted.example', 'test', fetcher), []);
  assert.equal(calls, 1);
});
