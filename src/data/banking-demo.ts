import type { FinancialState, Transaction } from '../types/finance';
import { addDays } from '../lib/finance/dates';

export const DEMO_START_DATE = '2026-09-12';

/** Versioned, pinned bank history. Existing v1 IDs are retained for safe upserts. */
export function bankingDemoProfile(): FinancialState {
  const userId = 'demo-user';
  const transactions: Transaction[] = [];
  function event(id: string, date: string, time: string, amountCents: number, category: string, merchant: string, eventType: Transaction['eventType'] = 'discretionary') {
    transactions.push({id, userId, accountId:'checking', timestamp:`${date}T${time}:00.000Z`, amountCents, category, merchant, eventType});
  }
  for (let i = -30; i < 30; i++) {
    const date = addDays('2026-08-13', i);
    const cycle = ((i % 5) + 5) % 5;
    const total = 1500 + cycle * 750;
    const even = i % 2 === 0;
    const slot = ((i % 4) + 4) % 4;
    event(`demo-history-v1-food-${i}`,date,'12:15',-Math.floor(total*2/3),even?'groceries':'dining',even?'H-E-B':i%3===0?'Chipotle':'Rice Coffeehouse');
    event(`demo-history-v1-other-${i}`,date,'18:30',-(total-Math.floor(total*2/3)),['transportation','shopping','entertainment','dining'][slot],['Shell','Target','Cinema','Starbucks'][slot]);
  }
  const recent: [string, number, string, string][] = [
    ['food-29',6241,'groceries','H-E-B'], ['other-29',3820,'transportation','Shell'],
    ['food-28',1473,'dining','Chipotle'], ['other-27',4499,'shopping','Amazon'],
    ['food-26',685,'dining','Starbucks'],
  ];
  for (const [suffix,amount,category,merchant] of recent) {
    const tx=transactions.find(t=>t.id===`demo-history-v1-${suffix}`)!;
    Object.assign(tx,{amountCents:-amount,category,merchant});
  }
  for (let i = -4; i < 4; i++) event(`demo-history-v1-pay-${i+1}`,addDays('2026-08-14',i*7),'08:00',90000,'income','Employer Payroll','income');
  event('demo-history-v1-rent','2026-08-13','09:00',-110000,'housing','Monthly rent','bill');
  event('demo-history-v1-phone','2026-08-14','09:00',-8000,'utilities','Phone plan','bill');
  event('demo-history-v1-power','2026-08-20','09:00',-6500,'utilities','Electric utility','bill');
  event('demo-history-v1-stream','2026-08-22','09:00',-1500,'subscriptions','Spotify','bill');
  event('demo-history-v2-netflix','2026-09-06','09:00',-1799,'subscriptions','Netflix','bill');
  event('demo-history-v2-rent','2026-07-14','09:00',-110000,'housing','Monthly rent','bill');
  event('demo-history-v2-uber','2026-07-20','21:00',-1840,'transportation','Uber');
  // Opening funding reconciles the historical ledger to the bank snapshot.
  event('demo-history-v1-opening','2026-08-13','00:00',185000-transactions.reduce((sum,t)=>sum+t.amountCents,0),'other','Demo opening adjustment','transfer');
  return {
    userId,startDate:DEMO_START_DATE,horizonDays:60,safetyBufferCents:40000,
    accounts:[
      {id:'checking',userId,name:'Everyday Checking',type:'checking',balanceCents:185000},
      {id:'emergency',userId,name:'Emergency Savings',type:'savings',balanceCents:210000},
      {id:'savings',userId,name:'Travel Savings',type:'savings',balanceCents:190000},
    ],transactions,
    bills:[
      {id:'rent',userId,name:'Rent',amountCents:110000,dueDate:addDays(DEMO_START_DATE,1),recurrence:'monthly',mandatory:true},
      {id:'phone',userId,name:'Phone Bill',amountCents:8000,dueDate:addDays(DEMO_START_DATE,3),recurrence:'monthly',mandatory:true},
      {id:'netflix',userId,name:'Netflix',amountCents:1799,dueDate:addDays(DEMO_START_DATE,6),recurrence:'monthly',mandatory:true},
      {id:'insurance',userId,name:'Car Insurance',amountCents:12600,dueDate:addDays(DEMO_START_DATE,12),recurrence:'monthly',mandatory:true},
    ],
    incomeEvents:[{id:'paycheck',userId,name:'Weekly paycheck',amountCents:90000,expectedDate:addDays(DEMO_START_DATE,5),recurrence:'weekly'}],
    goals:[
      {id:'japan',userId,name:'Japan Trip',targetCents:300000,savedCents:190000,maxDelayDays:14},
      {id:'emergency-reserve',userId,name:'Emergency fund (reserved)',targetCents:210000,savedCents:210000,maxDelayDays:0},
    ],
  };
}
