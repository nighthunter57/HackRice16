import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  DemoFinancialDataProvider, NessieFinancialDataProvider, loadFinancialState,
  extractProduct, getPreferences, savePreference, preferenceSchema,
  insertFinancialEvents, readDailySpending, saveSnapshot, readSnapshots, saveDecision, readDecisions,
  type FetchLike, type Queryable,
} from '../src/lib/integrations';
import { requestJson } from '../src/lib/integrations/http';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function nessieFixture(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const resources: Record<string, unknown> = {
    '/customers/customer': {_id:'customer',first_name:'Test',last_name:'User'},
    '/accounts/checking/transfers': [],
    '/customers/customer/accounts': [{ _id: 'checking', customer_id: 'customer', nickname: 'Everyday', type: 'Checking', balance: 1500.25 }, { _id: 'credit', customer_id: 'customer', type: 'Credit Card', balance: 500 }],
    '/accounts/checking/purchases': [
      { _id: 'p1', merchant_id: 'm1', purchase_date: '2026-09-10', amount: 19.99, status: 'completed' },
      { _id: 'p2', merchant_id: 'm1', purchase_date: '2026-09-12', amount: 12, status: 'completed' },
      { _id: 'p3', merchant_id: 'm1', purchase_date: '2026-09-11', amount: 5, status: 'pending' },
      { _id: 'p4', merchant_id: 'm1', purchase_date: '2026-09-11', amount: 6, status: 'cancelled' },
    ],
    '/accounts/checking/deposits': [
      { _id: 'd1', transaction_date: '2026-09-11', amount: 1000, status: 'executed', description: 'Payroll' },
      { _id: 'd2', transaction_date: '2026-09-20', amount: 1200, status: 'pending' },
      { _id: 'd3', transaction_date: '2026-09-01', amount: 999, status: 'pending' },
    ],
    '/accounts/checking/bills': [{ _id: 'b1', payee: 'Rent', payment_amount: 800, payment_date: '2026-09-15', status: 'pending' }],
    '/accounts/checking/withdrawals': [{ _id: 'w1', transaction_date: '2026-09-10', amount: 20, status: 'completed' }],
    '/merchants/m1': { _id: 'm1', name: 'Corner cafe', category: ['food', 'cafe'] },
    ...overrides,
  };
  const fetcher: FetchLike = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    assert.equal(url.searchParams.get('key'), 'test-key');
    assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    assert.ok(url.pathname in resources, `Unexpected URL: ${url.pathname}`);
    return json(resources[url.pathname]);
  };
  return { fetcher, calls };
}
const financialOptions = { apiKey: 'test-key', customerId: 'customer', startDate: '2026-09-12' };

test('Nessie normalizes cash, purchases/merchants, bills, withdrawals and scheduled income without replaying posted cash flows', async () => {
  const { fetcher, calls } = nessieFixture();
  const result = await new NessieFinancialDataProvider({ ...financialOptions, fetcher }).loadFinancialState();
  assert.equal(result.mode, 'live'); assert.equal(result.source, 'nessie');
  assert.equal(result.state.accounts.length, 1); assert.equal(result.state.accounts[0].balanceCents, 150025);
  assert.equal(result.state.transactions.find(item => item.id === 'nessie-purchase-p1')?.amountCents, -1999);
  assert.equal(result.state.transactions.find(item => item.id === 'nessie-purchase-p1')?.merchant, 'Corner cafe');
  assert.equal(result.state.transactions.find(item => item.id === 'nessie-purchase-p3')?.timestamp, '2026-09-12T00:00:00.000Z');
  assert.equal(result.state.transactions.some(item => item.id === 'nessie-purchase-p2'), false);
  assert.equal(result.historyTransactions.some(item => item.id === 'nessie-purchase-p2'), true);
  assert.equal(result.historyTransactions.some(item => item.id === 'nessie-purchase-p3'), false);
  assert.equal(result.state.incomeEvents.length, 1); assert.equal(result.state.incomeEvents[0].id, 'nessie-deposit-d2');
  assert.equal(result.state.incomeEvents[0].recurrence, 'once');
  assert.equal(result.state.bills[0].amountCents, 80000);
  assert.equal(calls.filter(path => path === '/merchants/m1').length, 1);
});

test('Nessie rejects malformed, cross-customer, impossible-date and missing required responses', async () => {
  const cases: Record<string, unknown>[] = [
    { '/customers/customer/accounts': [{ _id: 'checking' }] },
    { '/customers/customer/accounts': [{ _id: 'checking', customer_id: 'another', type: 'Checking', balance: 1 }] },
    { '/accounts/checking/purchases': [{ _id: 'p1', merchant_id: 'm1', purchase_date: '2026-02-30', amount: 1, status: 'completed' }] },
    { '/accounts/checking/bills': { message: 'wrong shape' } },
  ];
  for (const overrides of cases) {
    await assert.rejects(new NessieFinancialDataProvider({ ...financialOptions, fetcher: nessieFixture(overrides).fetcher }).loadFinancialState(), /invalid-response/);
  }
});

test('Nessie preserves month-end recurring bill anchor and conservatively carries overdue one-time bills forward', async () => {
  const { fetcher } = nessieFixture({ '/accounts/checking/bills': [
    { _id: 'b1', payee: 'Rent', payment_amount: 800, recurring_date: 31, status: 'recurring' },
    { _id: 'b2', payee: 'Utility', payment_amount: 50, payment_date: '2026-09-01', status: 'pending' },
  ] });
  const result = await new NessieFinancialDataProvider({ ...financialOptions, fetcher }).loadFinancialState();
  assert.equal(result.state.bills[0].dueDate, '2026-08-31');
  assert.equal(result.state.bills[0].recurrence, 'monthly');
  assert.equal(result.state.bills[1].dueDate, '2026-09-12');
});

test('configured live failures never silently become demo; explicit fallback is labelled', async () => {
  const fetcher: FetchLike = async () => json({ error: 'secret' }, 401);
  await assert.rejects(loadFinancialState({ ...financialOptions, mode: 'live', fetcher }), /401/);
  const fallback = await loadFinancialState({ ...financialOptions, mode: 'live', fetcher, allowDemoFallback: true });
  assert.equal(fallback.source, 'demo'); assert.equal(fallback.mode, 'demo');
  assert.ok(fallback.warnings.some(warning => warning.includes('Explicit fallback')));
  assert.ok(fallback.warnings.every(warning => !warning.includes('secret')));
  const demo = await new DemoFinancialDataProvider({ startDate: '2026-09-12' }).loadFinancialState();
  demo.state.accounts[0].balanceCents = 0;
  assert.notEqual((await new DemoFinancialDataProvider({ startDate: '2026-09-12' }).loadFinancialState()).state.accounts[0].balanceCents, 0);
});

test('REST retries reads after 429, limits retries, does not retry writes or reveal network secrets', async () => {
  let attempts = 0;
  const fetcher: FetchLike = async () => ++attempts === 1 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : json({ ok: true });
  assert.deepEqual(await requestJson('Test', 'https://example.com', z.object({ ok: z.boolean() }), {}, fetcher), { ok: true });
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(requestJson('Test', 'https://example.com', z.object({}), { method: 'POST' }, fetcher), /429/);
  assert.equal(attempts, 1);
  await assert.rejects(requestJson('Test', 'https://example.com?key=secret', z.object({}), {}, async () => { throw new Error('secret'); }), error => error instanceof Error && error.message === 'Test: network');
});

const product = { productName: 'Headphones', priceCents: 45000, category: 'electronics', purchaseType: 'discretionary', confidence: 0.95 };
const geminiResponse = (value: unknown, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }] });
test('Gemini sends multimodal REST request and validates integer cents with nullable missing price', async () => {
  const fetcher: FetchLike = async (url, init) => {
    assert.ok(String(url).endsWith(':generateContent'));
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'test-key');
    const body = z.object({ contents: z.array(z.object({ parts: z.array(z.unknown()) })), generationConfig: z.object({ responseMimeType: z.literal('application/json'), responseJsonSchema: z.object({}) }) }).parse(JSON.parse(String(init?.body)));
    assert.equal(body.contents[0].parts.length, 2);
    return json(geminiResponse({ ...product, priceCents: null }));
  };
  const result = await extractProduct({ text: 'These headphones', imageBase64: 'YWJj', mimeType: 'image/png' }, { apiKey: 'test-key', fetcher });
  assert.equal(result.mode, 'live'); assert.equal(result.product?.priceCents, null);
});

test('Gemini malformed output, blocked/truncated output, ambiguous input and service failure require manual entry', async () => {
  for (const response of [geminiResponse({ ...product, priceCents: 10.5 }), geminiResponse({ ...product, confidence: 2 }), geminiResponse(product, 'MAX_TOKENS'), { candidates: [] }]) {
    assert.equal((await extractProduct({ text: 'headphones' }, { apiKey: 'key', fetcher: async () => json(response) })).mode, 'manual');
  }
  assert.equal((await extractProduct({}, { apiKey: 'key' })).mode, 'manual');
  assert.equal((await extractProduct({ imageBase64: 'invalid', mimeType: 'image/png' }, { apiKey: 'key' })).mode, 'manual');
  assert.equal((await extractProduct({ text: 'headphones' }, { apiKey: 'key', fetcher: async () => json({}, 503) })).mode, 'manual');
  assert.equal((await extractProduct({ text: 'headphones' }, { apiKey: '' })).mode, 'manual');
});

const memoryOptions = { apiKey: 'test-key', assistantId: 'assistant' };
const memory = (id: string, value: unknown) => ({ memory_id: id, content: `canibuyit.preference.v1:${JSON.stringify(value)}` });
test('Backboard reads only typed preferences and refuses conflicting or financial memory', async () => {
  const result = await getPreferences({ ...memoryOptions, fetcher: async () => json({ memories: [
    memory('1', { key: 'riskTolerance', value: 'cautious' }), memory('2', { key: 'riskTolerance', value: 'flexible' }),
    memory('3', { key: 'explanationStyle', value: 'concise' }), memory('4', { key: 'balance', value: 5000 }),
    { memory_id: '5', content: 'Account balance is $5000' },
  ] }) });
  assert.equal(result.mode, 'live'); assert.deepEqual(result.preferences, [{ key: 'explanationStyle', value: 'concise' }]);
  assert.ok(result.warnings.some(warning => warning.includes('Conflicting')));
  assert.equal(preferenceSchema.safeParse({ key: 'riskTolerance', value: 'cautious', balanceCents: 5000 }).success, false);
});

test('Backboard writes real assistant memory and updates existing preference via PUT', async () => {
  const methods: string[] = [];
  const fetcher: FetchLike = async (url, init) => {
    assert.ok(String(url).includes('/assistants/assistant/memories'));
    assert.equal(new Headers(init?.headers).get('X-API-Key'), 'test-key');
    methods.push(init?.method ?? 'GET');
    if (!init?.method) return json({ memories: [] });
    assert.ok(String(init.body).includes('canibuyit.preference.v1:'));
    return json({ memory_id: 'new-memory' }, 201);
  };
  assert.deepEqual(await savePreference({ key: 'riskTolerance', value: 'cautious' }, { ...memoryOptions, fetcher }), { mode: 'live', memoryId: 'new-memory' });
  assert.deepEqual(methods, ['GET', 'POST']);
  const updated = await savePreference({ key: 'riskTolerance', value: 'balanced' }, { ...memoryOptions, fetcher: async (url, init) => {
    if (!init?.method) return json({ memories: [memory('old', { key: 'riskTolerance', value: 'cautious' })] });
    assert.equal(init.method, 'PUT'); assert.ok(String(url).endsWith('/old'));
    return json({ memory_id: 'old' });
  } });
  assert.equal(updated.mode, 'live');
});

test('Backboard failed persistence never claims saved; absent service is unavailable', async () => {
  assert.equal((await savePreference({ key: 'spendingPriority', value: 'saving' }, { ...memoryOptions, fetcher: async () => json({}, 401) })).mode, 'unavailable');
  assert.equal((await getPreferences({ apiKey: '', assistantId: '' })).mode, 'unavailable');
});

test('Tiger event insert is parameterized, deduplicates and refreshes backfilled aggregate buckets', async () => {
  const { state } = await new DemoFinancialDataProvider({ startDate: '2026-09-12' }).loadFinancialState();
  const calls: { sql: string; values?: unknown[] }[] = [];
  const db: Queryable = { async query(sql, values) { calls.push({ sql, values }); return { rows: [], rowCount: 1 }; } };
  const event = { ...state.transactions[0], merchant: "Robert'); DROP TABLE financial_events;--" };
  const result = await insertFinancialEvents([event, event], { db, userId: state.userId });
  assert.equal(result.mode, 'live'); assert.equal(calls.length, 3);
  assert.ok(!calls[0].sql.includes(event.merchant)); assert.ok(calls[0].sql.includes('ON CONFLICT'));
  assert.equal(z.array(z.unknown()).parse(JSON.parse(String(calls[0].values?.[1]))).length, 1);
  assert.ok(calls[1].sql.includes('refresh_continuous_aggregate'));
  assert.deepEqual(calls[1].values, ['2026-07-14T00:00:00Z', '2026-07-15T00:00:00Z']);
});

test('Tiger spending returns complete UTC days including zero; rejects unsafe bigint and malformed date ranges', async () => {
  const db: Queryable = { async query(sql, values) {
    assert.ok(sql.includes('generate_series')); assert.ok(sql.includes("AT TIME ZONE 'UTC'"));
    assert.deepEqual(values, ['demo-user', '2026-09-10', '2026-09-12']);
    return { rows: [{ date: '2026-09-10', spending_cents: '4500' }, { date: '2026-09-11', spending_cents: '0' }, { date: '2026-09-12', spending_cents: '500' }] };
  } };
  const result = await readDailySpending('2026-09-10', '2026-09-12', { db, userId: 'demo-user' });
  assert.equal(result.mode, 'live'); assert.equal(result.data?.[1].spendingCents, 0);
  assert.equal((await readDailySpending('2026-09-12', '2026-09-12', { db: { async query() { return { rows: [{ date: '2026-09-12', spending_cents: '9007199254740992' }] }; } } })).mode, 'unavailable');
  await assert.rejects(readDailySpending('2026-09-12', '2026-09-10', { db }), /range/);
});

test('Tiger snapshots and decisions round-trip validated records, scoped to the configured user', async () => {
  const { state } = await new DemoFinancialDataProvider({ startDate: '2026-09-12' }).loadFinancialState();
  const decision = { productName: 'Monitor', priceCents: 40000, verdict: 'CAUTION', safeDate: '2026-09-21', action: 'wait', source: 'demo' } satisfies Parameters<typeof saveDecision>[0];
  let snapshotId = ''; let decisionId = '';
  const db: Queryable = { async query(sql, values) {
    if (sql.startsWith('INSERT INTO financial_snapshots')) { snapshotId = String(values?.[0]); assert.equal(values?.[1], 'demo-user'); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO purchase_decisions')) { decisionId = String(values?.[0]); return { rows: [] }; }
    assert.deepEqual(values, ['demo-user', 10]);
    return { rows: sql.includes('FROM financial_snapshots') ? [{ id: snapshotId, created_at: '2026-09-12T00:00:00.000Z', source: 'demo', state }] : [{ id: decisionId, created_at: '2026-09-12T00:00:00.000Z', decision }] };
  } };
  const options = { db, userId: 'demo-user' };
  assert.equal((await saveSnapshot(state, 'demo', options)).mode, 'live');
  assert.equal((await saveDecision(decision, options)).mode, 'live');
  assert.deepEqual((await readSnapshots(10, options)).data?.[0].state, state);
  assert.deepEqual((await readDecisions(10, options)).data?.[0].decision, decision);
  assert.equal((await saveSnapshot(state, 'demo', { db, userId: 'other' })).mode, 'unavailable');
});

test('Tiger unavailable database never fabricates empty history or write success', async () => {
  const db: Queryable = { async query() { throw new Error('database-password'); } };
  const result = await readDailySpending('2026-09-12', '2026-09-12', { db });
  assert.equal(result.mode, 'unavailable'); assert.equal(result.data, null);
  assert.ok(!JSON.stringify(result).includes('database-password'));
});

test('canonical migration defines hypertable, category aggregates and duplicate protection', async () => {
  const schema = await readFile('database/schema.sql','utf8');
  const aggregates = await readFile('database/aggregates.sql','utf8');
  assert.ok(schema.includes("create_hypertable('public.financial_events'"));
  assert.ok(schema.includes('financial_events_identity ON public.financial_events(user_id,event_id,time)'));
  assert.match(aggregates,/timescaledb\.continuous/);
  assert.match(aggregates,/forecast_spent_cents/);
  assert.match(aggregates,/daily_cash_flow/);
});
