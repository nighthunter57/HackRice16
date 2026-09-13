import test from 'node:test';
import assert from 'node:assert/strict';
import { bankingDemoProfile } from '../src/data/banking-demo';
import { demoPurchase } from '../src/data/demo-profile';
import { applyFinancialSettings, settingsFor } from '../src/lib/finance/settings';
import { financialSettingsSchema } from '../src/types/financial-settings';
import { analyze } from '../src/lib/finance';
import { whyWait } from '../src/lib/finance/why-wait';
import { analysisInputSchema, buildDashboard } from '../src/lib/server/dashboard';
import { parseDashboard } from '../mobile/lib/api';

test('setup changes use integer cents and preserve immutable banking balances and source isolation',()=>{
  const state=bankingDemoProfile(), original=structuredClone(state), settings=settingsFor(state,'demo');
  settings.safetyBufferCents=70000;
  settings.bills=[{id:'custom-rent',userId:state.userId,name:'New rent',amountCents:12345,dueDate:state.startDate,recurrence:'monthly'}];
  const result=applyFinancialSettings(state,'demo',settings);
  assert.equal(result.safetyBufferCents,70000);
  assert.equal(result.bills.find(b=>b.id==='custom-rent')?.amountCents,12345);
  assert.deepEqual(state,original);
  assert.deepEqual(result.accounts,state.accounts);
  assert.equal(applyFinancialSettings(state,'nessie',settings),state);
  assert.throws(()=>financialSettingsSchema.parse({...settings,safetyBufferCents:0.5}));
  assert.throws(()=>financialSettingsSchema.parse({...settings,accountBalances:[100]}));
  assert.throws(()=>applyFinancialSettings(state,'demo',{...settings,accountIds:['not-owned']}));
});

test('account selection excludes unselected income and converts transfers across the spending pool',()=>{
  const state=bankingDemoProfile();state.goals=[];
  state.accounts=[{id:'one',userId:state.userId,name:'Checking',type:'checking',balanceCents:100000},{id:'two',userId:state.userId,name:'Savings',type:'savings',balanceCents:200000}];
  state.transactions=[{id:'nessie-transfer-x',accountId:'one',userId:state.userId,timestamp:`${state.startDate}T00:00:00.000Z`,amountCents:-10000,category:'transfer',merchant:'Transfer',eventType:'transfer'},
    {id:'nessie-transfer-x-credit',accountId:'two',userId:state.userId,timestamp:`${state.startDate}T00:00:00.000Z`,amountCents:10000,category:'transfer',merchant:'Transfer',eventType:'transfer'}];
  state.incomeEvents=[{id:'income',accountId:'two',userId:state.userId,amountCents:90000,expectedDate:state.startDate}];
  const settings={...settingsFor(state,'demo'),accountIds:['one']};
  const result=applyFinancialSettings(state,'demo',settings);
  assert.equal(result.accounts.length,1);assert.equal(result.incomeEvents.length,0);
  assert.equal(result.transactions[0].eventType,'bill');
  assert.equal(analyze(result,demoPurchase).today.balanceImpact.currentBalanceCents,100000);
});

test('bill edits replace by stable ID, exclusions persist, and goal constraints are validated',()=>{
  const state=bankingDemoProfile(), settings=settingsFor(state,'demo');
  settings.bills=[{...state.bills[0],amountCents:12300}];
  settings.excludedBillIds=[state.bills[1].id];
  const once=applyFinancialSettings(state,'demo',settings);
  const twice=applyFinancialSettings(once,'demo',settings);
  assert.deepEqual(once,twice);assert.equal(once.bills.filter(b=>b.id===state.bills[0].id).length,1);
  assert.equal(once.bills.some(b=>b.id===state.bills[1].id),false);
  settings.goals=[{id:'g',userId:state.userId,name:'Trip',targetCents:100,savedCents:101}];
  assert.throws(()=>applyFinancialSettings(state,'demo',settings),/cannot exceed/);
});

test('Why wait names actual recurring bills without calling positive immediate cash insufficient',()=>{
  const state=bankingDemoProfile();
  const result=analyze(state,demoPurchase), evidence=whyWait(result);
  assert.ok(result.today.balanceImpact.immediateBalanceAfterPurchaseCents>0);
  assert.match(evidence.explanation,/enough for the purchase now/);
  assert.ok(evidence.bills.length>0);
  for(const bill of evidence.bills) assert.ok(result.today.days.some(day=>day.date===bill.date && day.events.some(event=>event.type==='bill' && event.name===bill.name)));
});

test('server and mobile agree on configured reserve, bills and goal impacts',async()=>{
  const state=bankingDemoProfile(), settings=settingsFor(state,'demo');settings.safetyBufferCents=65000;
  settings.goals=[{...state.goals[0],deadline:'2026-09-30',maxDelayDays:0}];
  const result=await buildDashboard(analysisInputSchema.parse({purchase:demoPurchase,settings}),false);
  assert.equal(result.safetyBufferCents,65000);
  assert.equal(result.profile.goals[0].deadline,'2026-09-30');
  assert.deepEqual(parseDashboard(result,demoPurchase).analysis,result.analysis);
  assert.equal(result.planningProfile?.safetyBufferCents,40000);
  assert.ok(result.refreshedAt);
});

test('goal priority changes which goal receives the available surplus first',()=>{
  const state=bankingDemoProfile();
  state.accounts=[{id:'checking',userId:state.userId,name:'Checking',type:'checking',balanceCents:15000}];
  state.transactions=[];state.bills=[];state.incomeEvents=[];state.safetyBufferCents=5000;
  state.goals=['Trip','Laptop'].map(name=>({id:name,userId:state.userId,name,targetCents:10000,savedCents:0}));
  const purchase={...demoPurchase,priceCents:0};
  const before=analyze(state,purchase);
  const settings=settingsFor(state,'demo');settings.goals.reverse();
  const after=analyze(applyFinancialSettings(state,'demo',settings),purchase);
  assert.equal(before.today.goalImpacts.find(g=>g.name==='Trip')?.projectedDate,state.startDate);
  assert.equal(before.today.goalImpacts.find(g=>g.name==='Laptop')?.projectedDate,null);
  assert.equal(after.today.goalImpacts.find(g=>g.name==='Laptop')?.projectedDate,state.startDate);
  assert.equal(after.today.goalImpacts.find(g=>g.name==='Trip')?.projectedDate,null);
});

test('service selects settings for the returned source when a refresh switches profiles',async()=>{
  const state=bankingDemoProfile();
  const demoSettings={...settingsFor(state,'demo'),safetyBufferCents:54321};
  const bankSettings={...settingsFor(state,'nessie'),safetyBufferCents:99999};
  const result=await buildDashboard(analysisInputSchema.parse({purchase:demoPurchase,settings:bankSettings,settingsProfiles:[bankSettings,demoSettings]}),false);
  assert.equal(result.dataSource,'demo');assert.equal(result.safetyBufferCents,54321);
});
