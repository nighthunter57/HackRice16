import { z } from 'zod';
import { saveDecision, rememberDecision } from '@/lib/integrations';
import { limitedJson } from '@/lib/server/request';
import { financialRoute } from '@/lib/server/auth/http';
import { integrationsFor } from '@/lib/server/auth/integrations';
export {OPTIONS} from '@/lib/server/auth/http';
const schema = z.object({id:z.string().uuid(),item:z.string().min(1).max(120),priceCents:z.number().int().min(0).max(9_999_999_999),decision:z.enum(['BUY','WAIT']),date:z.string().datetime(),verdict:z.enum(['SAFE','CAUTION','NOT_RECOMMENDED']),source:z.enum(['demo','nessie']),safeDate:z.iso.date().nullable()}).strict();
export const POST=financialRoute(async (request,{userId})=>{
  try {
    const entry = schema.parse(await limitedJson(request));
    const action = entry.decision==='BUY'?'buy':'wait';
    const integrations=await integrationsFor(userId);
    const result = await saveDecision({productName:entry.item,priceCents:entry.priceCents,action,verdict:entry.verdict,safeDate:entry.safeDate,source:entry.source},{userId});
    const memory = await rememberDecision(entry.item,action,{assistantId:integrations.backboard_assistant_id??''});
    return Response.json({persisted:result.mode==='live',remembered:memory.mode==='live'});
  } catch { return Response.json({error:'Invalid decision record.'},{status:400}); }
});
