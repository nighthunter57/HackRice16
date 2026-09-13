import {createHash} from 'node:crypto';
import type {ScanResult} from '@/types/scan';
const cache=new Map<string,{expiresAt:number,result:ScanResult}>();
const pending=new Map<string,Promise<ScanResult>>();
export function recognitionFingerprint(input:{imageBase64?:string;mimeType?:string;text?:string},userId:string,model:string){
  return createHash('sha256').update(JSON.stringify([userId,model,'visual-v3',input.mimeType??'',input.imageBase64??'',input.text?.trim()??''])).digest('hex');
}
/** Short per-user development cache; no raw photos retained after the request. */
export async function recognizeCached(key:string,run:()=>Promise<ScanResult>,enabled=process.env.NODE_ENV==='development'){
  if(!enabled)return {result:await run(),cacheHit:false};
  for(const [key,entry] of cache)if(entry.expiresAt<=Date.now())cache.delete(key);
  const hit=cache.get(key);
  if(hit)return {result:structuredClone(hit.result),cacheHit:true};
  const active=pending.get(key);
  if(active)return {result:structuredClone(await active),cacheHit:true};
  const task=run();pending.set(key,task);
  try {
    const result=await task;
    if(cache.size>=32){const first=cache.keys().next().value;if(first)cache.delete(first);}
    cache.set(key,{result:structuredClone(result),expiresAt:Date.now()+300_000});
    return {result,cacheHit:false};
  } finally {pending.delete(key);}
}
