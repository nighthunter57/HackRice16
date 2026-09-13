import { z } from 'zod';
import { userSchema } from '../../types/auth';
import { apiUrl } from '../../../mobile/lib/endpoint';
import { ApiError } from './authenticated-fetch';
export { ApiError,createAuthenticatedFetch } from './authenticated-fetch';
export const sessionSchema=z.object({user:userSchema,accessToken:z.string().min(1),refreshToken:z.string().min(32).optional()});
export type Session=z.infer<typeof sessionSchema>;
export async function errorResponse(response:Response) {
  const result=z.object({error:z.string(),code:z.string().optional()}).safeParse(await response.json().catch(()=>null));
  return new ApiError(response.status,result.success?result.data.error:'The request could not be completed. Please try again.',result.success?result.data.code:undefined);
}
export async function authRequest(path:string,body?:unknown,method='POST',accessToken?:string) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  let response:Response;
  try {response=await fetch(`${apiUrl.replace(/\/$/,'')}${path}`,{method,credentials:'include',headers:{'Content-Type':'application/json',...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});}
  catch {throw new ApiError(0,'Cannot reach the server. Check your connection and try again.');}
  finally {clearTimeout(timer);}
  if(!response.ok)throw await errorResponse(response);
  const result:unknown=await response.json();return result;
}
