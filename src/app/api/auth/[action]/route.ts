import { z } from 'zod';
import { registerSchema,loginSchema,refreshSchema,forgotSchema,resetSchema,changePasswordSchema, type AuthTokens } from '@/types/auth';
import * as service from '@/lib/server/auth/service';
import { body,route,requireAuth,rateLimit } from '@/lib/server/auth/http';
import { AuthError } from '@/lib/server/auth/errors';
export {OPTIONS} from '@/lib/server/auth/http';
export const runtime='nodejs';
import { ttl } from '@/lib/server/auth/crypto';
const cookieName='canibuyit_refresh';
function tokenResponse(request:Request,tokens:AuthTokens) {
  if(!request.headers.get('origin'))return Response.json(tokens);
  const secure=process.env.NODE_ENV==='production'?'; Secure':'';
  return Response.json({user:tokens.user,accessToken:tokens.accessToken},{headers:{'Set-Cookie':`${cookieName}=${tokens.refreshToken}; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=${ttl('REFRESH_TOKEN_TTL_DAYS',7,30)*86400}${secure}`}});
}
function cookieToken(request:Request){return request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);}
export const POST=route(async request=>{
  const action=new URL(request.url).pathname.split('/').pop();
  if(action==='register') {
    await rateLimit(request,'register-ip','',5);
    const input=await body(request,registerSchema);await rateLimit(request,'register',input.email,5);
    return tokenResponse(request,await service.register(input));
  }
  if(action==='login') {
    await rateLimit(request,'login-ip','',20);
    const input=await body(request,loginSchema);await rateLimit(request,'login',input.email,10);
    return tokenResponse(request,await service.login(input));
  }
  if(action==='refresh') {
    await rateLimit(request,'refresh','',60);
    const raw=await body(request,z.object({refreshToken:refreshSchema.shape.refreshToken.optional()}).strict());
    const input=refreshSchema.parse({refreshToken:raw.refreshToken??cookieToken(request)});
    return tokenResponse(request,await service.refresh(input.refreshToken));
  }
  if(action==='forgot-password') {
    await rateLimit(request,'forgot-ip','',5);
    const input=await body(request,forgotSchema);await rateLimit(request,'forgot',input.email,3);
    return Response.json(await service.forgotPassword(input.email));
  }
  if(action==='reset-password') {
    await rateLimit(request,'reset','',5);
    const input=await body(request,resetSchema);return Response.json(await service.resetPassword(input.token,input.newPassword));
  }
  if(action==='logout') {
    const identity=await requireAuth(request);await service.logout(identity.userId,identity.sessionId);
    return Response.json({message:'Signed out.'},{headers:{'Set-Cookie':`${cookieName}=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`}});
  }
  if(action==='change-password') {
    const identity=await requireAuth(request);await rateLimit(request,'change',identity.userId,5);
    const input=await body(request,changePasswordSchema);
    return tokenResponse(request,await service.changePassword(identity.userId,input.currentPassword,input.newPassword));
  }
  throw new AuthError(404,'Endpoint not found.');
});
