import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createNessieClient } from '../src/lib/nessie/client';
import { NessieError } from '../src/lib/nessie/errors';
import { mapTransfer, mapAccount } from '../src/lib/nessie/mapper';

test('Nessie client centralizes authentication, JSON methods, and empty delete responses', async () => {
  const calls: string[]=[];
  const client=createNessieClient({apiKey:'test-secret',baseUrl:'https://api.nessieisreal.com',fetcher:async(url,init)=>{
    const parsed=new URL(String(url));
    assert.equal(parsed.searchParams.get('key'),'test-secret');
    assert.equal(parsed.origin,'https://api.nessieisreal.com');
    assert.equal(init?.redirect,'error');
    assert.ok(init?.signal);
    calls.push(init?.method ?? '');
    if(init?.method==='DELETE') return new Response(null,{status:204});
    if(init?.method==='POST' || init?.method==='PUT') assert.deepEqual(JSON.parse(String(init.body)),{amount:43});
    return Response.json({ok:true});
  }});
  const schema=z.object({ok:z.boolean()});
  await client.nessieGet('/accounts',schema);
  await client.nessiePost('/accounts/id/withdrawals',{amount:43},schema);
  await client.nessiePut('/withdrawals/id',{amount:43},schema);
  await client.nessieDelete('/withdrawals/id',z.undefined());
  assert.deepEqual(calls,['GET','POST','PUT','DELETE']);
});

test('Nessie failures are typed and do not reveal keys or upstream response bodies', async () => {
  for(const status of [401,403,429,500]) {
    const client=createNessieClient({apiKey:'secret',fetcher:async()=>Response.json({key:'secret',error:'private upstream data'},{status,headers:{'retry-after':'0'}})});
    await assert.rejects(client.nessieGet('/accounts',z.array(z.unknown())),e=>e instanceof NessieError && e.status===status && !e.message.includes('secret') && !e.message.includes('private'));
  }
  const invalid=createNessieClient({apiKey:'secret',fetcher:async()=>Response.json({wrong:true})});
  await assert.rejects(invalid.nessieGet('/accounts',z.array(z.unknown())),/invalid-response/);
  const network=createNessieClient({apiKey:'secret',fetcher:async()=>{throw new Error('secret URL');}});
  await assert.rejects(network.nessieGet('/accounts',z.array(z.unknown())),e=>e instanceof NessieError && e.message==='Nessie: network');
  for(const path of ['https://evil.example/accounts','//evil.example/accounts']) await assert.rejects(invalid.nessieGet(path,z.unknown()),/configuration/);
});

test('Nessie retries reads once but never automatically repeats writes', async () => {
  let reads=0,writes=0;
  const client=createNessieClient({apiKey:'test',fetcher:async(_url,init)=>{
    if(init?.method==='GET') return ++reads===1 ? Response.json({}, {status:429,headers:{'retry-after':'0'}}) : Response.json([]);
    writes++;
    return Response.json({}, {status:503});
  }});
  assert.deepEqual(await client.nessieGet('/accounts',z.array(z.unknown())),[]);
  await assert.rejects(client.nessiePost('/customers',{},z.unknown()),/503/);
  assert.equal(reads,2);assert.equal(writes,1);
});

test('Nessie timeout covers response reads and is safe to report', async () => {
  const client=createNessieClient({apiKey:'test',timeoutMs:5,fetcher:async(_url,init)=>{
    await new Promise(resolve=>setTimeout(resolve,15));
    if(init?.signal?.aborted) throw new Error('timeout includes secret URL');
    return Response.json([]);
  }});
  await assert.rejects(client.nessieGet('/accounts',z.array(z.unknown())),e=>e instanceof NessieError && e.code==='timeout');
});

test('transfer mapping distinguishes internal cash movement from outgoing obligations', () => {
  const checking=mapAccount({_id:'checking',customer_id:'user',type:'Checking',balance:1850},'user');
  const savings=mapAccount({_id:'savings',customer_id:'user',type:'Savings',balance:500},'user');
  assert.ok(checking && savings);
  const transfer={_id:'t',payer_id:'checking',payee_id:'savings',amount:43.21,transaction_date:'2026-09-11',status:'pending' as const};
  const internal=mapTransfer(transfer,[checking,savings],'user','2026-09-12');
  assert.equal(internal?.eventType,'transfer');
  assert.equal(internal?.amountCents,-4321);
  const external=mapTransfer({...transfer,payee_id:'outside'},[checking,savings],'user','2026-09-12');
  assert.equal(external?.eventType,'bill');
  assert.equal(external?.timestamp,'2026-09-12T00:00:00.000Z');
  assert.equal(mapTransfer({...transfer,status:'cancelled'},[checking,savings],'user','2026-09-12'),null);
  assert.throws(()=>mapTransfer({...transfer,payer_id:'outside',payee_id:'another'},[checking],'user','2026-09-12'),/invalid-response/);
});

test('provider records both internal transfer legs once and accepts empty-transfer 404', async () => {
  const { NessieFinancialDataProvider } = await import('../src/lib/nessie/provider');
  const resources: Record<string, unknown> = {
    '/customers/user': {_id:'user',first_name:'Demo',last_name:'User'},
    '/customers/user/accounts': [{_id:'checking',customer_id:'user',type:'Checking',balance:1850},{_id:'savings',customer_id:'user',type:'Savings',balance:500}],
    '/accounts/checking/transfers': [{_id:'t',payer_id:'checking',payee_id:'savings',amount:43.21,transaction_date:'2026-09-11',status:'executed'}],
    '/accounts/savings/transfers': [{_id:'t',payer_id:'checking',payee_id:'savings',amount:43.21,transaction_date:'2026-09-11',status:'executed'}],
  };
  const provider=new NessieFinancialDataProvider({apiKey:'test',customerId:'user',startDate:'2026-09-12',fetcher:async url=>Response.json(resources[new URL(String(url)).pathname]??[])});
  const loaded=await provider.loadFinancialState();
  assert.equal(loaded.historyTransactions.length,2);
  assert.equal(loaded.historyTransactions.reduce((sum,t)=>sum+t.amountCents,0),0);
  assert.equal(new Set(loaded.historyTransactions.map(t=>t.id)).size,2);
  const empty=new NessieFinancialDataProvider({apiKey:'test',customerId:'user',fetcher:async url=>{
    const path=new URL(String(url)).pathname;
    return path.endsWith('/transfers')?Response.json('No transfers found for this account',{status:404}):Response.json(resources[path]??[]);
  }});
  assert.equal((await empty.loadFinancialState()).historyTransactions.length,0);
});
