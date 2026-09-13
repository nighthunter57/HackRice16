/** Explicit development action: creates/reuses one pending $430 sandbox repair for today. */
import assert from 'node:assert/strict';
import { createDemoExpense } from '../src/lib/nessie/demo-expense';
import { analysisInputSchema, buildDashboard } from '../src/lib/server/dashboard';
import { closeTigerPool, runTiger } from '../src/lib/integrations/tiger';
import { IntegrationError } from '../src/lib/integrations/http';
import { parseDashboard } from '../mobile/lib/api';
import { analyze } from '../src/lib/finance';
async function main() {
  const input=analysisInputSchema.parse({purchase:{productName:'Headphones',priceCents:24900,category:'Electronics',purchaseType:'discretionary'}});
  const before=await buildDashboard(input,true);
  assert.equal(before.dataSource,'nessie');
  const receipt=await createDemoExpense({fetcher:async(url,init)=>{
    const response=await fetch(url,init);
    console.info({step:'Nessie expense',method:init?.method,path:new URL(String(url)).pathname,httpStatus:response.status});
    return response;
  }});
  const after=await buildDashboard({...input,previousSnapshotId:before.snapshotId},true);
  assert.equal(after.dataSource,'nessie');
  assert.ok(after.profile.transactions.some(t=>t.id===`nessie-withdrawal-${receipt.expenseId}`));
  const repeated=await createDemoExpense();
  assert.equal(repeated.expenseId,receipt.expenseId);
  const count=await runTiger({userId:after.profile.userId},async(db,userId)=>{
    const result=await db.query('SELECT count(*)::text AS count FROM financial_events WHERE user_id=$1 AND event_id=$2',[userId,`nessie-withdrawal-${receipt.expenseId}`]);
    assert.deepEqual(result.rows,[{count:'1'}]);return 'one-event';
  });
  assert.equal(count.mode,'live');
  assert.deepEqual(parseDashboard(after,input.purchase).analysis,after.analysis);
  const withoutRepair=analyze({...after.profile,transactions:after.profile.transactions.filter(t=>t.id!==`nessie-withdrawal-${receipt.expenseId}`)},input.purchase);
  assert.equal(withoutRepair.today.minimumBalanceCents-after.projectedMinimumBalanceCents,receipt.amountCents);
  console.info({expenseId:receipt.expenseId,status:receipt.status,tigerSynced:receipt.tigerSynced,currentBalanceCents:after.currentBalanceCents,
    minimumBefore:before.projectedMinimumBalanceCents,minimumAfter:after.projectedMinimumBalanceCents,safeDateBefore:before.safeDate,safeDateAfter:after.safeDate,
    causes:after.change?.causes,minimumWithoutRepair:withoutRepair.today.minimumBalanceCents,minimumWithRepair:after.projectedMinimumBalanceCents,repeatedAction:'same expense',tigerEventCount:1});
}
main().catch(error=>{console.error({verification:'failed',code:error instanceof IntegrationError?error.code:'validation',httpStatus:error instanceof IntegrationError?error.status:undefined});process.exitCode=1;}).finally(closeTigerPool);
