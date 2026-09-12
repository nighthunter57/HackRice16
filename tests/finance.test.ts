import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, simulate, addDays, occursOn } from '../src/lib/finance';
import { demoProfile, demoPurchase, injectRepair } from '../src/data/demo-profile';
import { dollarsToCents } from '../src/lib/display';
import type { FinancialState, Purchase } from '../src/types/finance';

function state(): FinancialState {
  return { userId:'test', startDate:'2026-09-12', horizonDays:30, safetyBufferCents:10_000,
    accounts:[{id:'checking',userId:'test',name:'Checking',type:'checking',balanceCents:50_000}],
    transactions:[], bills:[], incomeEvents:[], goals:[] };
}
function purchase(priceCents=10_000): Purchase { return {productName:'Headphones',priceCents,category:'electronics',purchaseType:'discretionary'}; }

test('clearly safe purchase preserves bills and reserve',()=>{
  const result=simulate(state(),purchase());
  assert.equal(result.verdict,'SAFE'); assert.equal(result.minimumBalanceCents,40_000);
  assert.equal(result.finalBalanceCents,40_000); assert.equal(result.billsCovered,true);
});
test('purchase causes negative balance and is not recommended',()=>{
  const result=simulate(state(),purchase(60_000));
  assert.equal(result.minimumBalanceCents,-10_000); assert.equal(result.verdict,'NOT_RECOMMENDED');
});
test('bills can be covered while purchase violates hard safety reserve',()=>{
  const input=state(); input.bills=[{id:'rent',userId:'test',name:'Rent',amountCents:10_000,dueDate:addDays(input.startDate,1),recurrence:'once'}];
  const result=simulate(input,purchase(35_000));
  assert.equal(result.billsCovered,true); assert.equal(result.minimumBalanceCents,5_000);
  assert.equal(result.safetyBufferViolation,true); assert.equal(result.verdict,'NOT_RECOMMENDED');
});
test('unsafe today, safe after confirmed paycheck',()=>{
  const input=state(); input.incomeEvents=[{id:'pay',userId:'test',amountCents:100_000,expectedDate:'2026-09-15'}];
  const result=analyze(input,purchase(60_000));
  assert.equal(result.safeDate,'2026-09-15'); assert.equal(result.waitDays,3); assert.equal(result.wait?.verdict,'SAFE');
});
test('a bill immediately after payday invalidates the tempting first payday',()=>{
  const input=state(); input.incomeEvents=[{id:'pay1',userId:'test',amountCents:100_000,expectedDate:'2026-09-15'},{id:'pay2',userId:'test',amountCents:100_000,expectedDate:'2026-09-22'}];
  input.bills=[{id:'rent',userId:'test',name:'Rent',amountCents:90_000,dueDate:'2026-09-16',recurrence:'once'}];
  assert.notEqual(simulate(input,purchase(60_000),'2026-09-15').verdict,'SAFE');
  assert.equal(analyze(input,purchase(60_000)).safeDate,'2026-09-22');
});
test('no safe date within horizon is null, never invented',()=>{
  const result=analyze(state(),purchase(500_000));
  assert.equal(result.safeDate,null); assert.equal(result.wait,null); assert.equal(result.waitDays,null);
});
test('exact reserve boundary is safe and one cent more is unsafe',()=>{
  assert.equal(simulate(state(),purchase(40_000)).verdict,'SAFE');
  assert.equal(simulate(state(),purchase(40_001)).verdict,'NOT_RECOMMENDED');
});
test('multiple bills on same day are all counted and coverage checked at payment time',()=>{
  const input=state(); input.bills=[10_000,45_000].map((amountCents,i)=>({id:`bill${i}`,userId:'test',name:`Bill ${i}`,amountCents,dueDate:'2026-09-13',recurrence:'once'}));
  const result=simulate(input); assert.equal(result.days[1].billsCents,55_000); assert.equal(result.billsCovered,false); assert.equal(result.minimumBalanceDate,'2026-09-13');
});
test('safe maximum is exact at the cent boundary and includes zero',()=>{
  assert.equal(analyze(state(),purchase()).safeMaximumCents,40_000);
  const input=state(); input.accounts[0].balanceCents=10_000;
  assert.equal(analyze(input,purchase()).safeMaximumCents,0);
  input.accounts[0].balanceCents=9_999; assert.equal(analyze(input,purchase(0)).safeMaximumCents,null);
});
test('goal delay comes from projected attainment dates',()=>{
  const input=state(); input.safetyBufferCents=0; input.accounts[0].balanceCents=10_000;
  input.goals=[{id:'trip',userId:'test',name:'Trip',targetCents:20_000,savedCents:0,maxDelayDays:14}];
  input.incomeEvents=[{id:'pay',userId:'test',amountCents:10_000,expectedDate:'2026-09-15',recurrence:'weekly'}];
  const goal=simulate(input,purchase(10_000)).goalImpacts[0];
  assert.equal(goal.baselineDate,'2026-09-15'); assert.equal(goal.projectedDate,'2026-09-22'); assert.equal(goal.delayDays,7);
});
test('baseline and input remain immutable while scenarios are generated',()=>{
  const input=demoProfile(); const copy=structuredClone(input); const baseline=simulate(input);
  analyze(input,demoPurchase); simulate(input,demoPurchase,'2026-09-25'); injectRepair(input);
  assert.deepEqual(input,copy); assert.deepEqual(simulate(input),baseline);
});
test('identical scenarios produce identical deterministic output',()=>{
  assert.deepEqual(analyze(demoProfile(),demoPurchase),analyze(demoProfile(),demoPurchase));
});
test('canonical demo: Sep18 becomes Sep25 after one repair; repeating repair is idempotent',()=>{
  const input=demoProfile(); const before=analyze(input,demoPurchase); const repaired=injectRepair(input); const after=analyze(repaired,demoPurchase);
  assert.equal(before.today.verdict,'NOT_RECOMMENDED'); assert.equal(before.today.minimumBalanceCents,4_100);
  assert.equal(before.safeDate,'2026-09-18'); assert.equal(after.safeDate,'2026-09-25');
  assert.deepEqual(injectRepair(repaired),repaired); assert.equal(after.baseline.finalBalanceCents,before.baseline.finalBalanceCents-43_000);
});
test('zero spending and a zero-dollar purchase do not invent cash-flow effects',()=>{
  const input=state(); const baseline=simulate(input); const result=simulate(input,purchase(0));
  assert.equal(result.finalBalanceCents,baseline.finalBalanceCents); assert.ok(result.days.every(day=>day.expectedSpendingCents===0));
});
test('monthly recurrence preserves Jan31 anchor across February and March',()=>{
  assert.equal(occursOn('2026-01-31','monthly','2026-02-28'),true);
  assert.equal(occursOn('2026-01-31','monthly','2026-03-31'),true);
  assert.equal(occursOn('2026-01-31','monthly','2026-03-28'),false);
  assert.equal(occursOn('2024-01-31','monthly','2024-02-29'),true);
});
test('same-day income clears before bills, with purchase after obligations',()=>{
  const input=state(); input.accounts[0].balanceCents=10_000;
  input.incomeEvents=[{id:'pay',userId:'test',amountCents:30_000,expectedDate:input.startDate}];
  input.bills=[{id:'bill',userId:'test',name:'Bill',amountCents:10_000,dueDate:input.startDate,recurrence:'once'}];
  const result=simulate(input,purchase(10_000)); assert.equal(result.verdict,'SAFE'); assert.equal(result.days[0].closingBalanceCents,20_000);
});
test('calendar days do not shift across DST and horizon is inclusive',()=>{
  const input=state(); input.startDate='2026-03-07'; input.horizonDays=3;
  assert.deepEqual(simulate(input).days.map(day=>day.date),['2026-03-07','2026-03-08','2026-03-09']);
  assert.throws(()=>simulate(input,purchase(),'2026-03-10'));
});
test('invalid money, date, overflow, duplicates, and cross-user data are rejected',()=>{
  assert.throws(()=>simulate(state(),purchase(0.1))); assert.throws(()=>simulate(state(),purchase(Number.MAX_SAFE_INTEGER+1)));
  assert.throws(()=>simulate(state(),purchase(-1)));
  const badDate=state(); badDate.startDate='2026-02-30'; assert.throws(()=>simulate(badDate));
  const overflow=state(); overflow.accounts[0].balanceCents=Number.MAX_SAFE_INTEGER; overflow.incomeEvents=[{id:'pay',userId:'test',amountCents:1,expectedDate:overflow.startDate}]; assert.throws(()=>simulate(overflow));
  const duplicate=state(); duplicate.accounts.push({...duplicate.accounts[0]}); assert.throws(()=>simulate(duplicate));
  const otherUser=state(); otherUser.accounts[0].userId='other'; assert.throws(()=>simulate(otherUser));
});
test('forecast distributes sub-cent daily averages without losing a cent over 30 days',()=>{
  const input=state(); input.transactions=[{id:'penny',userId:'test',accountId:'checking',timestamp:'2026-09-11T12:00:00.000Z',amountCents:-1,merchant:'Shop',category:'food',eventType:'discretionary'}];
  const result=simulate(input); assert.equal(result.days.reduce((sum,d)=>sum+d.expectedSpendingCents,0),1); assert.equal(result.finalBalanceCents,49_999);
});
test('reserved savings are excluded once and separate goals cannot claim the same surplus',()=>{
  const input=state(); input.goals=[{id:'g1',userId:'test',name:'First',targetCents:30_000,savedCents:10_000},{id:'g2',userId:'test',name:'Second',targetCents:30_000,savedCents:10_000}];
  const result=simulate(input); assert.equal(result.days[0].openingBalanceCents,30_000); assert.equal(result.goalImpacts[0].projectedDate,input.startDate); assert.equal(result.goalImpacts[1].projectedDate,null);
});
test('safe date matches chronological exhaustive oracle with irregular income and bills',()=>{
  for(let seed=1;seed<=6;seed++) {
    const input=state(); input.horizonDays=15;
    input.incomeEvents=[{id:'pay',userId:'test',amountCents:seed*5_000,expectedDate:addDays(input.startDate,seed),recurrence:'weekly'}];
    input.bills=[{id:'bill',userId:'test',name:'Bill',amountCents:22_000,dueDate:addDays(input.startDate,seed+1),recurrence:'once'}];
    const item=purchase(30_000);
    const dates=Array.from({length:input.horizonDays},(_,i)=>addDays(input.startDate,i));
    const expected=dates.find(date=>simulate(input,item,date).verdict==='SAFE')??null;
    assert.equal(analyze(input,item).safeDate,expected);
  }
});
test('manual currency conversion preserves cents and rejects extra decimals',()=>{
  assert.equal(dollarsToCents('0.29'),29); assert.equal(dollarsToCents('449.99'),44_999); assert.equal(dollarsToCents('0'),0);
  assert.equal(dollarsToCents('1.001'),null); assert.equal(dollarsToCents('-1'),null); assert.equal(dollarsToCents('Infinity'),null);
});

test('a small pending transaction does not erase the remaining daily spending estimate',()=>{
  const input=state();
  input.transactions=Array.from({length:30},(_,i)=>({id:`past${i}`,userId:'test',accountId:'checking',timestamp:`${addDays(input.startDate,-i-1)}T12:00:00.000Z`,amountCents:-100,merchant:'Food',category:'food',eventType:'discretionary'}));
  input.transactions.push({id:'pending',userId:'test',accountId:'checking',timestamp:`${input.startDate}T12:00:00.000Z`,amountCents:-10,merchant:'Food',category:'food',eventType:'discretionary'});
  const day=simulate(input).days[0]; assert.equal(day.expectedSpendingCents,90); assert.equal(day.transactionNetCents,-10); assert.equal(day.closingBalanceCents,49_900);
});
