import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProfile, demoPurchase, injectRepair } from '../src/data/demo-profile';
import { forecastChange } from '../src/lib/finance/changes';
import { tigerPoolConfig } from '../src/lib/integrations/tiger-config';
import { requestAnalysis, offlineDashboard, parseDashboard } from '../mobile/lib/api';
import { buildDashboard, analysisInputSchema } from '../src/lib/server/dashboard';
import type { Queryable } from '../src/lib/integrations/tiger';
import { bankingDemoProfile } from '../src/data/banking-demo';
import { analyze, addDays } from '../src/lib/finance';

test('mobile consumes server financial state, forwards snapshot/token, and rejects malformed financial data',async()=>{
  const response=offlineDashboard(demoPurchase,false);
  response.profile=injectRepair(demoProfile());
  response.services=[{name:'Tiger Data',mode:'live',detail:'Test query boundary'}];
  const result=await requestAnalysis(demoPurchase,false,'https://backend.example','private','11111111-1111-4111-8111-111111111111',async(url,init)=>{
    assert.equal(url,'https://backend.example/api/analyze');
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer private');
    assert.equal(JSON.parse(String(init?.body)).previousSnapshotId,'11111111-1111-4111-8111-111111111111');
    return Response.json(response);
  });
  assert.equal(result.analysis.safeDate,'2026-09-25');
  assert.equal(result.services[0].mode,'live');
  assert.throws(()=>parseDashboard({...response,profile:{...response.profile,safetyBufferCents:1.25}},demoPurchase));
  await assert.rejects(requestAnalysis(demoPurchase,false,'https://backend.example','',undefined,async()=>new Response('',{status:401})),/Please sign in/);
});

test('TLS always verifies hostname; configured CA path is supported without weakening checks',()=>{
  const config=tigerPoolConfig({DATABASE_URL:'postgres://user:secret@example.test/db?sslmode=no-verify&uselibpqcompat=true',TIGER_CA_CERT_PATH:'/trusted/ca.pem'});
  const url=new URL(config!.connectionString!);
  assert.equal(url.searchParams.get('sslmode'),'verify-full');
  assert.equal(url.searchParams.get('sslrootcert'),'/trusted/ca.pem');
  assert.equal(url.searchParams.has('uselibpqcompat'),false);
});

test('financial change report derives amounts/dates and reversals without mutating the prior state',()=>{
  const previous=demoProfile(), current=injectRepair(previous);
  current.bills.at(-1)!.name='Stored mechanic invoice';
  const change=forecastChange(previous,current,demoPurchase);
  assert.equal(change?.previousSafeDate,'2026-09-18');
  assert.equal(change?.newSafeDate,'2026-09-25');
  assert.match(change!.causes[0].label,/Stored mechanic invoice/);
  assert.equal(change!.causes[0].amountCents,43000);
  assert.equal(forecastChange(current,previous,demoPurchase)?.causes[0].amountCents,-43000);
  assert.equal(previous.bills.length,2);
  assert.equal(forecastChange(previous,{...current,safetyBufferCents:1},demoPurchase),null);
});

test('backend queries stored shocks before simulation and compares a user-scoped prior snapshot',async()=>{
  const previous=bankingDemoProfile();
  previous.transactions=Array.from({length:30},(_,i)=>({id:`test-${i}`,userId:previous.userId,accountId:'checking',timestamp:`${addDays(previous.startDate,-30+i)}T12:00:00.000Z`,amountCents:-3000,category:'Everyday',merchant:'Test',eventType:'discretionary'}));
  const priorId='11111111-1111-4111-8111-111111111111';
  const db:Queryable={async query(sql,values){
    if(sql.startsWith('SELECT state')) {assert.deepEqual(values,['demo-user',priorId]);return {rows:[{state:previous}]};}
    if(sql.includes('SELECT to_char(days.day')) return {rows:Array.from({length:30},(_,i)=>({date:addDays(previous.startDate,-30+i),spending_cents:'3000'}))};
    if(sql.includes('forecast_spent_cents::text')) return {rows:Array.from({length:30},(_,i)=>({day:addDays(previous.startDate,-30+i),category:'Everyday',spent_cents:'3000'}))};
    if(sql.includes('SELECT event_id')) return {rows:[{event_id:'stored-repair',user_id:'demo-user',time:'2026-09-20T00:00:00.000Z',account_id:'checking',amount_cents:'-43000',category:'transportation',merchant:'Stored mechanic invoice',event_type:'unexpected_expense',metadata:{}}]};
    if(sql.startsWith('CALL')) return {rows:[]};
    if(sql.startsWith('INSERT')) return {rows:[],rowCount:1};
    throw new Error(`Unexpected SQL in test: ${sql}`);
  }};
  const result=await buildDashboard(analysisInputSchema.parse({purchase:demoPurchase,previousSnapshotId:priorId}),true,{db});
  assert.equal(result.analysis.safeDate,analyze(injectRepair(previous),demoPurchase).safeDate);
  assert.equal(result.change?.previousSafeDate,analyze(previous,demoPurchase).safeDate);
  assert.equal(result.change?.causes[0].amountCents,43000);
  assert.match(result.change!.causes[0].label,/Stored mechanic invoice/);
  assert.equal(result.services.find(s=>s.name==='Tiger Data')?.mode,'live');
  assert.ok(result.snapshotId);
});
