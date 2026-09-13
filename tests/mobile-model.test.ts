import assert from "node:assert/strict";
import test from "node:test";
import {
  demoAnalysis,
  extractionSchema,
  historySchema,
  money,
  purchaseFromInput,
  verdict,
} from "../mobile/lib/model";

test("mobile input preserves cents and rejects blank, negative and ambiguous prices", () => {
  assert.equal(purchaseFromInput("Headphones", "449.99").priceCents, 44999);
  for (const price of ["", "-1", "1.001", "1e3", "NaN", "1,000"])
    assert.throws(() => purchaseFromInput("Item", price));
  assert.throws(() => purchaseFromInput(" ", "1"));
  assert.equal(money(44999), "$449.99");
});
test("mobile verdict distinguishes safe today, waiting and outside horizon", () => {
  assert.equal(
    verdict(demoAnalysis(purchaseFromInput("Item", "50"), false).analysis),
    "Safe",
  );
  const original = demoAnalysis(purchaseFromInput("Headphones", "449"), false);
  assert.equal(verdict(original.analysis), "Wait");
  assert.equal(original.analysis.safeDate, "2026-09-17");
  assert.equal(original.analysis.safeMaximumCents, 10795);
  assert.equal(
    demoAnalysis(original.purchase, true).analysis.safeDate,
    "2026-09-24",
  );
  assert.equal(original.profile.bills.length, 4);
  assert.equal(
    verdict(demoAnalysis(purchaseFromInput("Item", "999999"), false).analysis),
    "Not Safe Yet",
  );
});
test("mobile recognition permits a missing price but rejects fabricated monetary types", () => {
  const product = {
    productName: "Headphones",
    priceCents: null,
    category: null,
    purchaseType: "unknown",
    confidence: 0.4,
  };
  assert.ok(extractionSchema.safeParse({ product }).success);
  assert.equal(
    extractionSchema.safeParse({ product: { ...product, priceCents: "449" } })
      .success,
    false,
  );
  assert.equal(
    extractionSchema.safeParse({ product: { ...product, confidence: 2 } })
      .success,
    false,
  );
});
test("stored mobile checks validate purchase data and retain scenario and decision", () => {
  const entry = {
    id: "one",
    purchase: purchaseFromInput("Headphones", "449"),
    checkedAt: "2026-09-12T12:00:00.000Z",
    repair: true,
    decision: "Wait for it",
  };
  assert.deepEqual(historySchema.parse([entry]), [entry]);
  assert.equal(
    historySchema.safeParse([
      { ...entry, purchase: { ...entry.purchase, priceCents: -1 } },
    ]).success,
    false,
  );
});

test('purchase input uses the backend limits and retains legacy saved entries', async () => {
  const { analysisInputSchema } = await import('../src/lib/server/dashboard');
  const purchase = purchaseFromInput('A'.repeat(120), '99999999.99');
  assert.equal(analysisInputSchema.safeParse({ purchase }).success, true);
  assert.throws(() => purchaseFromInput('A'.repeat(121), '10'));
  assert.throws(() => purchaseFromInput('Item', '100000000'));
  assert.throws(() => purchaseFromInput('Item', '10', ''));
  assert.equal(historySchema.safeParse([{
    id: 'legacy', purchase: { ...purchase, productName: 'A'.repeat(200) },
    checkedAt: '2026-09-12T12:00:00.000Z', repair: false, decision: 'Checked',
  }]).success, true);
});

test('failed analysis requests reject instead of returning a demo verdict', async () => {
  const { requestAnalysis } = await import('../mobile/lib/api');
  const purchase = purchaseFromInput('Item', '10');
  for (const status of [400, 401, 500, 502]) {
    await assert.rejects(requestAnalysis(purchase, false, 'http://test', '', undefined,
      async () => Response.json({ error: 'Unavailable' }, { status })));
  }
  await assert.rejects(requestAnalysis(purchase, false, 'http://test', '', undefined,
    async () => { throw new Error('Network unavailable'); }));
  await assert.rejects(requestAnalysis(purchase, false, 'http://test', '', undefined,
    async () => Response.json({ invalid: true })));
});
