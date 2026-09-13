import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { addDays } from '../src/lib/finance/dates';
import { createNessieClient } from '../src/lib/nessie/client';
import { accountSchema, customerSchema, createdSchema, purchaseSchema, movementSchema, merchantSchema } from '../src/lib/nessie/types';
import { IntegrationError, utcDateSchema } from '../src/lib/integrations/http';

async function main() {
  const client = createNessieClient();
  const customerId = process.env.NESSIE_CUSTOMER_ID;
  const accountId = process.env.NESSIE_ACCOUNT_ID;
  if (!customerId || !accountId) throw new Error('Run setup first.');
  const customer = await client.nessieGet(`/customers/${customerId}`,customerSchema);
  const account = await client.nessieGet(`/accounts/${accountId}`,accountSchema);
  if (customer.first_name !== 'CanIBuyIt' || customer.last_name !== 'Demo User' || account.customer_id !== customerId || account.nickname !== 'CanIBuyIt Everyday Checking') throw new Error('Not the demo account.');
  const date = utcDateSchema.parse(process.env.NESSIE_DEMO_SEED_DATE || new Date().toISOString().slice(0,10));
  if (!process.env.NESSIE_DEMO_SEED_DATE) writeFileSync('.env.local',`${readFileSync('.env.local','utf8').trimEnd()}\nNESSIE_DEMO_SEED_DATE=${date}\n`,{mode:0o600});
  const [purchases,deposits,merchantResult] = await Promise.all([
    client.nessieGet(`/accounts/${accountId}/purchases`,z.array(purchaseSchema)),
    client.nessieGet(`/accounts/${accountId}/deposits`,z.array(movementSchema)),
    client.nessieGet('/merchants',z.union([z.array(merchantSchema),z.object({data:z.array(merchantSchema)})])),
  ]);
  const merchants = Array.isArray(merchantResult) ? merchantResult : merchantResult.data;
  const activity = [
    {name:'H-E-B',amount:62.41,category:'groceries'}, {name:'Shell',amount:38.20,category:'transportation'},
    {name:'Chipotle',amount:14.73,category:'dining'}, {name:'Amazon',amount:44.99,category:'shopping'},
    {name:'Starbucks',amount:6.85,category:'dining'}, {name:'Netflix',amount:17.99,category:'subscriptions'},
  ];
  const counts = {merchants:0,purchases:0,deposits:0,bills:0};
  for (const item of activity) {
    const name = `CanIBuyIt Demo ${item.name}`;
    let merchantId = merchants.find(m => m.name === name)?._id;
    if (!merchantId) {
      const created = await client.nessiePost('/merchants',{name,category:item.category,address:{street_number:'6100',street_name:'Main Street',city:'Houston',state:'TX',zip:'77005'},geocode:{lat:29.7174,lng:-95.4018}},createdSchema);
      merchantId = created.objectCreated._id;
      counts.merchants++;
    }
    const index = activity.indexOf(item);
    for (let cycle=0;cycle<5;cycle++) {
      const description = `canibuyit-seed-v1:${index}:${cycle}`;
      if (purchases.some(p=>p.description===description)) continue;
      await client.nessiePost(`/accounts/${accountId}/purchases`,{merchant_id:merchantId,medium:'balance',purchase_date:addDays(date,-(index+cycle*6+1)),amount:item.amount,status:'completed',description},createdSchema);
      counts.purchases++;
    }
  }
  for (const offset of [-21,-7,5,19,33,47,61]) {
    const description = `canibuyit-seed-v1:payroll:${offset}`;
    if (deposits.some(d=>d.description===description)) continue;
    await client.nessiePost(`/accounts/${accountId}/deposits`,{medium:'balance',amount:900,transaction_date:addDays(date,offset),status:offset<0?'executed':'pending',description},createdSchema);
    counts.deposits++;
  }
  const schedulePath = '.local/nessie-schedule.json';
  mkdirSync('.local',{recursive:true});
  if (!existsSync(schedulePath)) {
    const bills = [{name:'Rent',amount:135000,day:1},{name:'Phone',amount:6500,day:8},{name:'Insurance',amount:12000,day:12},{name:'Subscriptions',amount:3000,day:16}]
      .map(item=>({id:`schedule:${item.name}`,userId:customerId,name:item.name,amountCents:item.amount,dueDate:addDays(date,item.day),recurrence:'monthly',mandatory:true}));
    writeFileSync(schedulePath,JSON.stringify({userId:customerId,replaceNessieBills:true,bills,incomeEvents:[],goals:[{id:'schedule:japan',userId:customerId,name:'Japan trip',targetCents:200000,savedCents:0,maxDelayDays:14}]},null,2)+'\n');
  }
  let env = readFileSync('.env.local','utf8');
  if (!/^NESSIE_SCHEDULE_PATH=.+$/m.test(env)) {
    env = /^NESSIE_SCHEDULE_PATH=.*$/m.test(env) ? env.replace(/^NESSIE_SCHEDULE_PATH=.*$/m,`NESSIE_SCHEDULE_PATH=${schedulePath}`) : `${env.trimEnd()}\nNESSIE_SCHEDULE_PATH=${schedulePath}\n`;
    writeFileSync('.env.local',env,{mode:0o600});
  }
  console.info({seedDate:date,created:counts,accountId});
  const finalAccount = await client.nessieGet(`/accounts/${accountId}`,accountSchema);
  const finalPurchases = await client.nessieGet(`/accounts/${accountId}/purchases`,z.array(purchaseSchema));
  const finalDeposits = await client.nessieGet(`/accounts/${accountId}/deposits`,z.array(movementSchema));
  console.info({balance:finalAccount.balance,purchases:finalPurchases.length,purchaseStatuses:[...new Set(finalPurchases.map(p=>p.status))],deposits:finalDeposits.length,depositStatuses:[...new Set(finalDeposits.map(d=>d.status))]});
}
main().catch(error=>{console.error({status:'seed-failed',code:error instanceof IntegrationError?error.code:'validation',httpStatus:error instanceof IntegrationError?error.status:undefined});process.exitCode=1;});
