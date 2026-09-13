import { preferenceSchema, savePreference } from '@/lib/integrations';
import { financialRoute,body } from '@/lib/server/auth/http';
import { integrationsFor } from '@/lib/server/auth/integrations';
import { authDatabase } from '@/lib/server/auth/database';
export {OPTIONS} from '@/lib/server/auth/http';
export const GET=financialRoute(async (_request,{userId})=>{
  const rows=(await authDatabase().query('SELECT key,value FROM user_preferences WHERE user_id=$1',[userId])).rows;
  return Response.json({preferences:rows.map(row=>preferenceSchema.parse(row))});
});
export const POST=financialRoute(async (request,{userId})=>{
  const value=await body(request,preferenceSchema);
  await authDatabase().query('INSERT INTO user_preferences(user_id,key,value) VALUES($1,$2,$3) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value',[userId,value.key,value.value]);
  const integrations=await integrationsFor(userId);
  const remote=await savePreference(value,{assistantId:integrations.backboard_assistant_id??''});
  return Response.json({saved:true,memorySynced:remote.mode==='live'});
});
