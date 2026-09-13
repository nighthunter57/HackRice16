import { z } from 'zod';
import { errors } from 'jose';
import { authDatabase,userLockDatabase } from './database';
import { tokenHash, verifyAccessToken } from './crypto';
import { AuthError } from './errors';
import { limitedJson } from '../request';
export function allowedOrigin(request:Request) {
  const origin=request.headers.get('origin');
  if(!origin)return true;
  try {
    const parsed=new URL(origin);
    const destination=new URL(request.url);
    const same=parsed.host===(request.headers.get('host')??destination.host) && parsed.protocol===destination.protocol;
    const configured=(process.env.AUTH_ALLOWED_ORIGINS??'').split(',').map(v=>v.trim()).filter(Boolean);
    return ['http:','https:'].includes(parsed.protocol) && (same || configured.includes(parsed.origin));
  } catch{return false;}
}
export function corsHeaders(request:Request) {
  const headers=new Headers({'Cache-Control':'no-store','Vary':'Origin'});
  const origin=request.headers.get('origin');
  if(origin && allowedOrigin(request)){
    headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Allow-Credentials','true');
    headers.set('Access-Control-Allow-Headers','Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods','GET, POST, PATCH, DELETE, OPTIONS');
  }
  return headers;
}
export async function requireAuth(request:Request) {
  if(!allowedOrigin(request))throw new AuthError(403,'This origin is not allowed.');
  const header=request.headers.get('authorization');
  if(!header?.startsWith('Bearer '))throw new AuthError(401,'Please sign in.','NOT_AUTHENTICATED');
  let identity;
  try{identity=await verifyAccessToken(header.slice(7));}
  catch(error){if(error instanceof errors.JWTExpired)throw new AuthError(401,'Your session needs refreshing.','ACCESS_EXPIRED');throw new AuthError(401,'Please sign in again.','INVALID_TOKEN');}
  const result=await authDatabase().query('SELECT id FROM auth_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now()',[identity.sessionId,identity.userId]);
  if(!result.rowCount)throw new AuthError(401,'Please sign in again.','SESSION_REVOKED');
  return identity;
}
export function route(handler:(request:Request)=>Promise<Response>) {
  return async(request:Request)=>{
    let response:Response;
    try{if(!allowedOrigin(request))throw new AuthError(403,'This origin is not allowed.');response=await handler(request);}
    catch(error){
      const status=error instanceof AuthError?error.status:error instanceof z.ZodError?400:500;
      response=Response.json({error:error instanceof AuthError?error.message:status===400?'Check the fields and try again.':'Unable to complete this request. Please try again.',...(error instanceof AuthError && error.code?{code:error.code}:{})},{status});
      if(status===500)console.info('[auth.request]',{status:'failed'});
    }
    corsHeaders(request).forEach((value,key)=>response.headers.set(key,value));
    return response;
  };
}
export const OPTIONS=route(async()=>new Response(null,{status:204}));
export async function body<T>(request:Request,schema:z.ZodType<T>,maximum=16000):Promise<T>{
  let value:unknown;try{value=await limitedJson(request,maximum);}catch{throw new AuthError(400,'Provide a valid JSON request.');}return schema.parse(value);
}
/** Shared database counters survive restarts. Only trust proxy IP headers if the deployment opts in. */
export async function rateLimit(request:Request,action:string,identity='',limit=10) {
  const ip=process.env.AUTH_TRUST_PROXY==='true'?request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'unknown':'shared';
  for(const key of [`ip:${ip}:${action}`,...(identity?[`identity:${action}:${identity}`]:[])]) {
    const cap=key.startsWith('ip:')?limit*10:limit;
    const hash=tokenHash(key,'rate');
    const result=await authDatabase().query(`INSERT INTO auth_rate_limits(key_hash,attempts,resets_at) VALUES($1,1,now()+interval '15 minutes')
      ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.resets_at<=now() THEN 1 ELSE auth_rate_limits.attempts+1 END,
      resets_at=CASE WHEN auth_rate_limits.resets_at<=now() THEN now()+interval '15 minutes' ELSE auth_rate_limits.resets_at END RETURNING attempts`,[hash]);
    if(z.object({attempts:z.number()}).parse(result.rows[0]).attempts>cap)throw new AuthError(429,'Too many attempts. Please try again in 15 minutes.');
  }
  await authDatabase().query("DELETE FROM auth_rate_limits WHERE resets_at<now()-interval '1 day'");
}

/** Serialize user mutations/financial requests with account deletion without a global lock. */
export function financialRoute(handler:(request:Request,identity:{userId:string;sessionId:string})=>Promise<Response>) {
  return route(async request=>{
    const identity=await requireAuth(request);
    const db=await userLockDatabase().connect();
    try {
      await db.query('SELECT pg_advisory_lock(hashtextextended($1,1))',[identity.userId]);
      await requireAuth(request);
      const deleting=(await authDatabase().query('SELECT user_id FROM account_deletion_requests WHERE user_id=$1',[identity.userId])).rowCount;
      if(deleting && !(request.method==='DELETE' && new URL(request.url).pathname==='/api/me'))throw new AuthError(409,'Account deletion is in progress. Retry deletion from Profile.');
      return await handler(request,identity);
    } finally {
      try{await db.query('SELECT pg_advisory_unlock(hashtextextended($1,1))',[identity.userId]);}finally{db.release();}
    }
  });
}
