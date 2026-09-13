import test from 'node:test';
import assert from 'node:assert/strict';
import {readFinancialSchedule} from '../src/lib/financial-providers/schedule';
import {providerEnvironment} from '../src/lib/server/auth/integrations';
test('hosted schedule validates ownership and needs no local file',()=>{
 const env={NESSIE_CUSTOMER_ID:'customer',NESSIE_SCHEDULE_JSON:JSON.stringify({userId:'customer',bills:[],incomeEvents:[],goals:[]})};
 assert.equal(readFinancialSchedule(env)?.userId,'customer');
 assert.throws(()=>readFinancialSchedule({...env,NESSIE_CUSTOMER_ID:'other'}));
 assert.throws(()=>readFinancialSchedule({...env,NESSIE_SCHEDULE_JSON:'not json'}));
 assert.equal(readFinancialSchedule({}),undefined);
});
test('unlinked accounts cannot inherit global hosted schedules',()=>{
 const previous=process.env.NESSIE_SCHEDULE_JSON;
 try{process.env.NESSIE_SCHEDULE_JSON='private schedule';
 assert.equal(providerEnvironment({nessie_customer_id:null,nessie_checking_account_id:null,backboard_assistant_id:null}).NESSIE_SCHEDULE_JSON,undefined);
 }finally{if(previous===undefined)delete process.env.NESSIE_SCHEDULE_JSON;else process.env.NESSIE_SCHEDULE_JSON=previous;}
});
