import { z } from 'zod';
import { nameSchema } from '@/types/auth';
import { body,route,requireAuth,financialRoute } from '@/lib/server/auth/http';
import { getUser,updateName } from '@/lib/server/auth/service';
import { deleteAccount } from '@/lib/server/auth/deletion';
export {OPTIONS} from '@/lib/server/auth/http';
export const runtime='nodejs';
export const GET=route(async request=>Response.json(await getUser((await requireAuth(request)).userId)));
export const PATCH=route(async request=>{
  const {userId}=await requireAuth(request);const input=await body(request,z.object({name:nameSchema}).strict());
  return Response.json(await updateName(userId,input.name));
});
export const DELETE=financialRoute(async (request,{userId})=>{
  await body(request,z.object({confirmation:z.literal('DELETE')}).strict());
  await deleteAccount(userId);return Response.json({message:'Your account has been deleted.'},{headers:{'Set-Cookie':`canibuyit_refresh=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`}});
});
