import { analysisInputSchema, buildDashboard } from '@/lib/server/dashboard';
import { limitedJson } from '@/lib/server/request';
import { financialRoute } from '@/lib/server/auth/http';
import { integrationsFor,providerEnvironment } from '@/lib/server/auth/integrations';
export {OPTIONS} from '@/lib/server/auth/http';
import { createDemoExpense } from '@/lib/nessie/demo-expense';
export const runtime='nodejs';
export const POST=financialRoute(async (request,{userId})=>{
  if(process.env.NODE_ENV==='production' || process.env.NESSIE_DEMO_EXPENSE_ENABLED!=='true')
    return Response.json({error:'This development action is unavailable.'},{status:404});
  const integrations=await integrationsFor(userId);
  const env=providerEnvironment(integrations);
  try {
    const parsed=analysisInputSchema.safeParse(await limitedJson(request,64_000));
    if(!parsed.success) return Response.json({error:'Check the purchase and financial setup.'},{status:400});
    if(parsed.data.settings && !parsed.data.settings.accountIds.includes(integrations.nessie_checking_account_id??''))
      return Response.json({error:'Include the demo checking account in Financial setup first.'},{status:400});
    const receipt=await createDemoExpense({env,applicationUserId:userId});
    // A refresh can fail after a successful write. Preserve the verified receipt.
    let dashboard;
    try {dashboard=await buildDashboard(parsed.data,true,{},userId);} catch { /* Receipt lets the caller refresh safely. */ }
    return Response.json({...receipt,dashboard},{headers:{'Cache-Control':'no-store'}});
  } catch {
    return Response.json({error:'The expense could not be confirmed. Refresh finances before retrying; a pending request may already exist.'},{status:503});
  }
});
