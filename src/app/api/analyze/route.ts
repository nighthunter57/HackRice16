import { analysisInputSchema, buildDashboard } from '@/lib/server/dashboard';
import { financialRoute,body } from '@/lib/server/auth/http';
export {OPTIONS} from '@/lib/server/auth/http';
export const runtime='nodejs';
export const POST=financialRoute(async (request,{userId})=>{
  const input=await body(request,analysisInputSchema,64_000);
  return Response.json(await buildDashboard(input,true,{},userId));
});
