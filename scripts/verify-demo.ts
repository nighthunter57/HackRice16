import assert from 'node:assert/strict';
import { buildDashboard, analysisInputSchema } from '../src/lib/server/dashboard';
import { demoPurchase } from '../src/data/demo-profile';
import { closeTigerPool } from '../src/lib/integrations/tiger';

async function verify() {
  if(process.env.DEMO_MODE!=='true') throw new Error('Requires explicit DEMO_MODE=true');
  const before=await buildDashboard(analysisInputSchema.parse({purchase:demoPurchase}),true);
  assert.equal(before.dataSource,'demo');
  assert.equal(before.services.find(s=>s.name==='Tiger Data')?.mode,'live','Tiger must be live');
  assert.ok(before.spendingFeatures);
  assert.notEqual(before.analysis.today.verdict,'SAFE');
  assert.ok(before.analysis.safeDate);
  const after=await buildDashboard(analysisInputSchema.parse({purchase:demoPurchase,repair:true,previousSnapshotId:before.snapshotId}),true);
  assert.equal(after.services.find(s=>s.name==='Tiger Data')?.mode,'live');
  assert.ok(after.analysis.safeDate && after.analysis.safeDate>before.analysis.safeDate);
  assert.ok(after.change?.causes.some(c=>c.amountCents===43000));
  const restored=await buildDashboard(analysisInputSchema.parse({purchase:demoPurchase,repair:false,previousSnapshotId:after.snapshotId}),true);
  assert.equal(restored.analysis.safeDate,before.analysis.safeDate);
  console.log(JSON.stringify({dataSource:before.dataSource,tiger:'live',safeDate:before.analysis.safeDate,
    repairSafeDate:after.analysis.safeDate,restoredSafeDate:restored.analysis.safeDate,
    safeMaximumCents:before.analysis.safeMaximumCents,spendingFeatures:before.spendingFeatures,causes:after.change?.causes},null,2));
}
void verify().catch(()=>{console.error('Demo verification failed. Check Tiger credentials/schema and DEMO_MODE.');process.exitCode=1;}).finally(closeTigerPool);
