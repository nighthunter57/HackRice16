import assert from 'node:assert/strict';
import test from 'node:test';
import { demoProfile, demoPurchase, injectRepair } from '../src/data/demo-profile';
import { forecastChange } from '../src/lib/finance/changes';

test('change report explains a new bill with the resulting Safe Date shift', () => {
  const change = forecastChange(demoProfile(), injectRepair(demoProfile()), demoPurchase);
  assert.equal(change?.previousSafeDate, '2026-09-18');
  assert.equal(change?.newSafeDate, '2026-09-25');
  assert.equal(change?.causes[0]?.amountCents, 43_000);
});

test('change report ignores spending outside the forecast history window', () => {
  const previous = demoProfile();
  const current = structuredClone(previous);
  current.transactions.push({
    id: 'old-history',
    userId: current.userId,
    accountId: 'checking',
    timestamp: '2026-01-01T12:00:00.000Z',
    amountCents: -50_000,
    merchant: 'Old purchase',
    category: 'shopping',
    eventType: 'discretionary',
  });
  assert.equal(forecastChange(previous, current, demoPurchase), null);
});
