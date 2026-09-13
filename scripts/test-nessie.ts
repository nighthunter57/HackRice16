import assert from 'node:assert/strict';
import { z } from 'zod';
import { createNessieClient } from '../src/lib/nessie/client';
import { customerSchema, accountSchema } from '../src/lib/nessie/types';
import { createFinancialProvider } from '../src/lib/financial-providers';
import { buildDashboard, analysisInputSchema } from '../src/lib/server/dashboard';
import { closeTigerPool, insertFinancialEvents, runTiger } from '../src/lib/integrations/tiger';
import { parseDashboard } from '../mobile/lib/api';
import { IntegrationError } from '../src/lib/integrations/http';

async function verify() {
  if (process.env.DEMO_MODE === 'true') throw new Error('DEMO_MODE forces demo');
  const customerId = z.string().min(1).parse(process.env.NESSIE_CUSTOMER_ID);
  z.string().min(1).parse(process.env.NESSIE_API_KEY);
  const client = createNessieClient();
  const customer = await client.nessieGet(`/customers/${customerId}`,customerSchema);
  const accounts = await client.nessieGet(`/customers/${customerId}/accounts`,z.array(accountSchema));
  console.info({authentication:'passed',customerId:customer._id,accounts:accounts.map(a=>({id:a._id,type:a.type,balanceCents:Math.round(a.balance*100)}))});
  const loaded = await createFinancialProvider().loadFinancialState();
  console.info({source:loaded.source,history:loaded.historyTransactions.length,bills:loaded.state.bills.length,expectedIncome:loaded.state.incomeEvents.length,merchants:loaded.merchants.length});
  const purchase = {productName:'Headphones',priceCents:24900,category:'electronics',purchaseType:'discretionary' as const};
  const dashboard = await buildDashboard(analysisInputSchema.parse({purchase,mode:'live'}),true);
  assert.equal(dashboard.dataSource,'nessie');
  const tiger = dashboard.services.find(service=>service.name==='Tiger Data');
  console.info({tiger:tiger?.mode,detail:tiger?.detail});
  assert.equal(tiger?.mode,'live');
  const count = () => runTiger({userId:customerId},async(db,userId)=>{
    const result=await db.query("SELECT count(*)::text AS total, count(DISTINCT event_id)::text AS distinct_ids FROM financial_events WHERE user_id=$1 AND event_id LIKE 'nessie-%'",[userId]);
    return z.object({total:z.string(),distinct_ids:z.string()}).parse(result.rows[0]);
  });
  const firstCount=await count();
  const repeated=await insertFinancialEvents(loaded.historyTransactions,{userId:customerId});
  assert.equal(repeated.mode,'live');
  const secondCount=await count();
  assert.deepEqual(secondCount,firstCount);
  assert.equal(secondCount.mode,'live');
  if(secondCount.mode==='live') assert.equal(secondCount.data.total,secondCount.data.distinct_ids);
  const mobile = parseDashboard(dashboard,purchase);
  assert.equal(mobile.currentBalanceCents,dashboard.currentBalanceCents);
  assert.equal(mobile.immediateBalanceAfterPurchaseCents,dashboard.currentBalanceCents-purchase.priceCents);
  assert.deepEqual(mobile.analysis, dashboard.analysis);
  console.info({dataSource:dashboard.dataSource,currentBalanceCents:dashboard.currentBalanceCents,purchasePriceCents:dashboard.purchasePriceCents,
    immediateBalanceAfterPurchaseCents:dashboard.immediateBalanceAfterPurchaseCents,projectedMinimumBalanceCents:dashboard.projectedMinimumBalanceCents,
    safetyBufferCents:dashboard.safetyBufferCents,bufferDifferenceCents:dashboard.bufferDifferenceCents,verdict:dashboard.verdict,safeDate:dashboard.safeDate,
    snapshotId:dashboard.snapshotId,tigerEvents:secondCount.mode==='live'?secondCount.data:undefined,duplicateIngestion:'passed',mobileBoundary:'passed'});
}
verify().catch(error=>{console.error({status:'verification-failed',code:error instanceof IntegrationError?error.code:'assertion-or-validation',httpStatus:error instanceof IntegrationError?error.status:undefined});process.exitCode=1;}).finally(closeTigerPool);
