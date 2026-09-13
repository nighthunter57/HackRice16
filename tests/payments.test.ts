import test from 'node:test';
import assert from 'node:assert/strict';
import { bankingDemoProfile } from '../src/data/banking-demo';
import { demoPurchase } from '../src/data/demo-profile';
import { settingsFor, applyFinancialSettings } from '../src/lib/finance/settings';
import { nextPaymentDate, savePayment, removePayment } from '../src/lib/finance/payments';
import { analyze } from '../src/lib/finance';
import { forecastChange } from '../src/lib/finance/changes';

test('custom payments preserve month-end anchors and cents across edits, reload and removal',()=>{
  const state=bankingDemoProfile();state.startDate='2027-01-31';state.horizonDays=90;state.bills=[];state.transactions=[];state.incomeEvents=[];state.goals=[];
  const payment={id:'custom-fee',userId:state.userId,name:'Studio space',amountCents:1234,dueDate:'2027-01-31',recurrence:'monthly' as const};
  assert.equal(nextPaymentDate(payment,'2027-02-01'),'2027-02-28');
  assert.equal(nextPaymentDate(payment,'2027-03-01'),'2027-03-31');
  assert.equal(nextPaymentDate({...payment,recurrence:'once'},'2027-02-01'),null);
  let settings=savePayment(settingsFor(state,'demo'),payment);
  settings=savePayment(settings,{...payment,amountCents:2345});
  const profile=applyFinancialSettings(state,'demo',JSON.parse(JSON.stringify(settings)));
  assert.equal(profile.bills.length,1);
  const events=analyze(profile,demoPurchase).baseline.days.flatMap(day=>day.events.filter(e=>e.name==='Studio space').map(e=>({date:day.date,amount:e.amountCents})));
  assert.deepEqual(events.slice(0,3),[{date:'2027-01-31',amount:-2345},{date:'2027-02-28',amount:-2345},{date:'2027-03-31',amount:-2345}]);
  assert.equal(applyFinancialSettings(state,'demo',removePayment(settings,payment.id)).bills.length,0);
  assert.throws(()=>savePayment(settings,{...payment,userId:'another-user'}));
  assert.throws(()=>savePayment(settings,{...payment,amountCents:0}));
});

test('future payments affect forecast, not money available immediately; frequency changes are explained',()=>{
  const state=bankingDemoProfile();state.bills=[];state.goals=[];state.transactions=[];state.incomeEvents=[];
  const before=analyze(state,demoPurchase);
  const payment={id:'fee',userId:state.userId,name:'Custom fee',amountCents:43000,dueDate:state.startDate,recurrence:'monthly' as const};
  const profile=applyFinancialSettings(state,'demo',savePayment(settingsFor(state,'demo'),payment));
  const after=analyze(profile,demoPurchase);
  assert.equal(before.today.balanceImpact.immediateBalanceAfterPurchaseCents,after.today.balanceImpact.immediateBalanceAfterPurchaseCents);
  assert.ok(after.today.balanceImpact.projectedMinimumBalanceCents<before.today.balanceImpact.projectedMinimumBalanceCents);
  const weekly={...profile,bills:[{...payment,recurrence:'weekly' as const}]};
  assert.ok(forecastChange(profile,weekly,demoPurchase)?.causes.some(c=>c.label.includes('weekly')));
});
