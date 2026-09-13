import { z } from 'zod';
export class ApiError extends Error {constructor(readonly status:number,message:string,readonly code?:string){super(message);}}
/** Single retry after access expiry. Other authorization failures do not loop. */
export function createAuthenticatedFetch(getAccess:()=>string|undefined,refresh:()=>Promise<string>,expired:()=>Promise<void>,fetcher:typeof fetch=fetch):typeof fetch {
  return async(input,init)=>{
    const send=(token?:string)=>{
      const headers=new Headers(init?.headers);if(token)headers.set('Authorization',`Bearer ${token}`);else headers.delete('Authorization');
      return fetcher(input,{...init,headers,credentials:'include'});
    };
    let attemptedToken=getAccess();
    let response=await send(attemptedToken);
    if(response.status!==401)return response;
    const error=z.object({code:z.string().optional()}).safeParse(await response.clone().json().catch(()=>null));
    const current=getAccess();
    if(current && current!==attemptedToken || error.success && error.data.code==='ACCESS_EXPIRED') {
      try{attemptedToken=current && current!==attemptedToken?current:await refresh();response=await send(attemptedToken);}
      catch(cause){if(cause instanceof ApiError && cause.status===0)throw cause;if(getAccess()===attemptedToken)await expired();throw cause;}
    }
    if(response.status===401 && getAccess()===attemptedToken)await expired();
    return response;
  };
}
