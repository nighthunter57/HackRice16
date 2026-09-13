'use client';
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {userSchema} from '@/types/auth';
import {createAuthenticatedFetch} from '@/lib/auth/authenticated-fetch';
const session=z.object({accessToken:z.string(),user:userSchema});
/** The optional Next preview shares the API's HttpOnly browser session. */
export function useBrowserSession(){
  const token=useRef<string|undefined>(undefined);
  const [user,setUser]=useState<z.infer<typeof userSchema>|null>(null);
  const generation=useRef(0);
  const pending=useRef<Promise<string>|null>(null);
  async function clear(){generation.current++;token.current=undefined;setUser(null);}
  async function request(action:string,body:unknown){
    const version=generation.current;
    const response=await fetch(`/api/auth/${action}`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok){const error=z.object({error:z.string()}).safeParse(await response.json());throw new Error(error.success?error.data.error:'Please sign in again.');}
    const result=session.parse(await response.json());
    if(version!==generation.current)throw new Error('Your session changed. Please try again.');
    token.current=result.accessToken;setUser(result.user);return result.accessToken;
  }
  async function refresh(){
    if(pending.current)return pending.current;
    const operation=request('refresh',{});pending.current=operation;
    try{return await operation;}finally{pending.current=null;}
  }
  const restore=useRef(refresh);
  useEffect(()=>{void restore.current().catch(()=>{});},[]);
  const apiFetch:typeof fetch=(input,init)=>createAuthenticatedFetch(()=>token.current,refresh,clear)(input,init);
  async function logout(){
    const response=await apiFetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if(!response.ok)throw new Error('Could not sign out. Please try again.');await clear();
  }
  return {user,apiFetch,login:(email:string,password:string)=>{generation.current++;return request('login',{email,password});},logout};
}
