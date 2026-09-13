import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FinancialEvent } from '../src/lib/integrations/tiger-analytics';
import { createDemoExpense } from '../src/lib/nessie/demo-expense';
const env={NODE_ENV:'test',NESSIE_DEMO_EXPENSE_ENABLED:'true',NESSIE_ACCOUNT_ID:'account',NESSIE_CUSTOMER_ID:'customer',NESSIE_API_KEY:'test'};

test('Nessie expense validates ownership, reuses a confirmed record, and syncs stable cents',async()=>{
  const journalDirectory=await mkdtemp(join(tmpdir(),'nessie-expense-'));
  let writes=0;let expense:Record<string,unknown>|undefined;
  const events:string[]=[];
  const fetcher:typeof fetch=async(url,init)=>{
    const path=new URL(String(url)).pathname;
    if(path==='/accounts/account') return Response.json({_id:'account',customer_id:'customer',nickname:'CanIBuyIt Demo Checking',type:'Checking',balance:1850});
    if(init?.method==='POST') {writes++;expense={...JSON.parse(String(init.body)),_id:'expense',payer_id:'account'};return Response.json({code:201,objectCreated:{_id:'expense'}});}
    if(path==='/withdrawals/expense') return Response.json(expense);
    return Response.json(expense?[expense]:[]);
  };
  try {
    const options={env,journalDirectory,fetcher,sync:async(event:FinancialEvent)=>{events.push(event.eventId);assert.equal(event.amountCents,-43000);return {mode:'live' as const,data:{inserted:true}};}};
    const first=await createDemoExpense(options), second=await createDemoExpense(options);
    assert.equal(first.expenseId,second.expenseId);assert.equal(writes,1);assert.equal(first.status,'pending');
    assert.deepEqual(events,['nessie-withdrawal-expense','nessie-withdrawal-expense']);
    await assert.rejects(createDemoExpense({...options,env:{...env,NODE_ENV:'production'}}),/not enabled/);
  } finally {await rm(journalDirectory,{recursive:true,force:true});}
});

test('an uncertain Nessie write cannot be repeated after retry or process restart',async()=>{
  const journalDirectory=await mkdtemp(join(tmpdir(),'nessie-uncertain-'));let writes=0;
  const fetcher:typeof fetch=async(url,init)=>{
    if(init?.method==='POST'){writes++;throw new Error('network disconnected');}
    return Response.json(new URL(String(url)).pathname==='/accounts/account'?{_id:'account',customer_id:'customer',nickname:'CanIBuyIt Demo',type:'Checking',balance:1850}:[]);
  };
  try {
    await assert.rejects(createDemoExpense({env,journalDirectory,fetcher}));
    await assert.rejects(createDemoExpense({env,journalDirectory,fetcher}),/may already be processing/);
    assert.equal(writes,1);
    await assert.rejects(createDemoExpense({env:{...env,NESSIE_CUSTOMER_ID:'other'},journalDirectory,fetcher}),/configured CanIBuyIt/);
  } finally {await rm(journalDirectory,{recursive:true,force:true});}
});

test('expense endpoint requires authentication including in production',async()=>{
  const {POST}=await import('../src/app/api/demo-expense/route');
  const previous=process.env;
  try {
    process.env={...previous,NODE_ENV:'production',NESSIE_DEMO_EXPENSE_ENABLED:'true'};
    assert.equal((await POST(new Request('http://localhost/api/demo-expense',{method:'POST'}))).status,401);
    process.env={...previous,NODE_ENV:'test',NESSIE_DEMO_EXPENSE_ENABLED:'true'};
    assert.equal((await POST(new Request('http://localhost/api/demo-expense',{method:'POST'}))).status,401);
  } finally {process.env=previous;}
});
