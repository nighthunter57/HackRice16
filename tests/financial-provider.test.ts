import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinancialProvider, DemoFinancialDataProvider, NessieFinancialDataProvider, type FinancialDataProvider } from '../src/lib/financial-providers';
import { financialStateSchema } from '../src/types/financial-state-schema';
import { analyze } from '../src/lib/finance';
import { demoPurchase, injectRepair } from '../src/data/demo-profile';
import { parseDashboard, offlineDashboard } from '../mobile/lib/api';

test('demo provider supplies valid, deterministic banking history and reserved savings',async()=>{
  const provider:FinancialDataProvider=new DemoFinancialDataProvider();
  const state=financialStateSchema.parse(await provider.getUserFinancialState('demo-user'));
  assert.deepEqual((await provider.getAccounts('demo-user')).map(a=>a.balanceCents),[185000,210000,190000]);
  assert.equal((await provider.getBills('demo-user')).length,4);
  assert.equal((await provider.getIncomeEvents('demo-user'))[0].expectedDate,'2026-09-17');
  const history=await provider.getTransactions('demo-user');
  assert.equal(history.length,136);
  assert.equal(new Set(history.map(t=>t.timestamp.slice(0,10))).size,60);
  assert.equal(history.reduce((sum,t)=>sum+t.amountCents,0),185000);
  for(const category of ['groceries','dining','transportation','shopping','subscriptions','entertainment','utilities','housing','income']) assert.ok(history.some(t=>t.category===category));
  assert.deepEqual(await provider.getUserFinancialState('demo-user'),state);
  await assert.rejects(provider.getAccounts('another-user'),/mismatch/);
  const result=analyze(state,demoPurchase);
  assert.equal(result.baseline.days[0].openingBalanceCents,185000,'Savings are reserved, not spendable');
  assert.notEqual(result.today.verdict,'SAFE');
  assert.equal(result.safeDate,'2026-09-17');
  assert.equal(analyze(injectRepair(state),demoPurchase).safeDate,'2026-09-24');
  assert.equal(analyze(state,{...demoPurchase,priceCents:100}).safeDate,state.startDate);
  assert.equal(analyze(state,{...demoPurchase,priceCents:999999999}).safeDate,null);
});

test('DEMO_MODE and missing keys select demo without making Nessie calls',async()=>{
  for(const env of [{DEMO_MODE:'true',NESSIE_API_KEY:'unavailable'}, {DEMO_MODE:'true',NESSIE_API_KEY:''},{DEMO_MODE:'false',NESSIE_API_KEY:''}]) {
    const provider=createFinancialProvider({},env);
    assert.ok(provider instanceof DemoFinancialDataProvider);
    assert.equal((await provider.loadFinancialState()).source,'demo');
  }
  const provider=createFinancialProvider({},{DEMO_MODE:'false',NESSIE_API_KEY:'configured',NESSIE_CUSTOMER_ID:'user'});
  assert.ok(provider instanceof NessieFinancialDataProvider);
  assert.equal(provider.dataSource,'nessie');
});

test('mobile consumes either source through the same normalized contract',()=>{
  const demo=offlineDashboard(demoPurchase,false);
  const connected={...demo,dataSource:'nessie' as const};
  assert.deepEqual(parseDashboard(demo,demoPurchase).analysis,parseDashboard(connected,demoPurchase).analysis);
  assert.equal(parseDashboard(connected,demoPurchase).dataSource,'nessie');
});

test('dashboard labels the demo fallback when the configured provider fails', async (t) => {
  const { buildDashboard, analysisInputSchema } = await import('../src/lib/server/dashboard');
  const originalDemoMode = process.env.DEMO_MODE;
  const originalKey = process.env.NESSIE_API_KEY;
  process.env.DEMO_MODE = 'false';
  process.env.NESSIE_API_KEY = 'test';
  t.mock.method(NessieFinancialDataProvider.prototype, 'loadFinancialState', async () => {
    throw new Error('Provider unavailable');
  });
  try {
    const result = await buildDashboard(analysisInputSchema.parse({ purchase: demoPurchase }), true);
    assert.equal(result.dataSource, 'demo');
    assert.ok(result.services[0].detail.includes("Financial data couldn't refresh. Using demo data."));
  } finally {
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
    if (originalKey === undefined) delete process.env.NESSIE_API_KEY;
    else process.env.NESSIE_API_KEY = originalKey;
  }
});
