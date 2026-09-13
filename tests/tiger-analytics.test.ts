import test from 'node:test';
import assert from 'node:assert/strict';
import { getDailySpending, getForecastInputs, getDayOfWeekAverages, insertFinancialEvent, compareSpendingToExpectation } from '../src/lib/integrations/tiger-analytics';
import type { Queryable } from '../src/lib/integrations/tiger';

test('analytics preserves zero-spend days and rejects cents outside safe integer range', async () => {
  const db:Queryable={async query(sql,values) {
    assert.ok(sql.includes("AT TIME ZONE 'UTC'"));
    assert.deepEqual(values,['demo-user','2026-09-10','2026-09-12']);
    return {rows:[{day:'2026-09-10',spent_cents:'0',event_count:'0'},{day:'2026-09-11',spent_cents:'1872',event_count:'1'}]};
  }};
  assert.deepEqual((await getDailySpending('demo-user',2,'2026-09-12',{db})).data,[{day:'2026-09-10',spentCents:0,eventCount:0},{day:'2026-09-11',spentCents:1872,eventCount:1}]);
  const invalid:Queryable={async query(){return {rows:[{day:'2026-09-11',spent_cents:'9007199254740992',event_count:'1'}]};}};
  assert.equal((await getDailySpending('demo-user',1,'2026-09-12',{db:invalid})).mode,'unavailable');
  await assert.rejects(getDailySpending('demo-user',0,'2026-09-12',{db}));
});

test('forecast inputs use ordinary spending and integer rounded weekday features',async()=>{
  const db:Queryable={async query(sql){
    assert.ok(sql.includes('forecast_spent_cents'));
    return {rows:sql.includes('isodow')?[{weekday:2,average_cents:'2813',sample_days:'4'}]:[{rolling_30_cents:'90000',rolling_7_cents:'23250',average_daily_cents:'3000'}]};
  }};
  assert.deepEqual((await getForecastInputs('demo-user','2026-09-12',{db})).data,{rolling30Cents:90000,rolling7Cents:23250,averageDailyCents:3000});
  assert.deepEqual((await getDayOfWeekAverages('demo-user','2026-09-12',{db})).data,[{weekday:2,averageCents:2813,sampleDays:4}]);
});

test('repair insertion is parameterized, retry-safe, UTC-scoped and refreshes both aggregates',async()=>{
  const calls:{sql:string;values?:unknown[]}[]=[];
  const db:Queryable={async query(sql,values){calls.push({sql,values});return {rows:[],rowCount:0};}};
  const event={eventId:'demo-repair',userId:'demo-user',accountId:'checking',time:'2026-09-20T00:00:00.000Z',amountCents:-43000,category:'transportation',merchant:"Auto'; DROP TABLE x;--",eventType:'unexpected_expense' as const,metadata:{source:'canibuyit-demo'}};
  assert.deepEqual((await insertFinancialEvent(event,{db})).data,{inserted:false});
  assert.equal(calls.length,3);
  assert.ok(!calls[0].sql.includes(event.merchant));
  assert.ok(calls[0].sql.includes('DO NOTHING'));
  assert.ok(calls[1].sql.includes('daily_spending'));
  assert.ok(calls[2].sql.includes('daily_cash_flow'));
  assert.deepEqual(calls[2].values,['2026-09-20T00:00:00Z','2026-09-21T00:00:00Z']);
  await assert.rejects(insertFinancialEvent(event,{db,userId:'other'}),/mismatch/);
  await assert.rejects(insertFinancialEvent({...event,amountCents:-430.5},{db}));
});

test('change explanation uses supplied expectations; unknown baselines stay unknown',async()=>{
  const db:Queryable={async query(){return {rows:[{category:'dining',spent_cents:'9600'},{category:'transportation',spent_cents:'43000'}]};}};
  assert.deepEqual((await compareSpendingToExpectation('demo-user','2026-09-12',{dining:2000},{db})).data,[
    {category:'dining',actualCents:9600,expectedCents:2000,aboveBaselineCents:7600},
    {category:'transportation',actualCents:43000,expectedCents:null,aboveBaselineCents:null},
  ]);
});
