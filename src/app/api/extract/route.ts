import {scanProduct} from '@/lib/server/scan';
import {limitedJson} from '@/lib/server/request';
import {route,requireAuth} from '@/lib/server/auth/http';
export {OPTIONS} from '@/lib/server/auth/http';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {DEFAULT_GEMINI_MODEL} from '@/lib/integrations/gemini';
import {IntegrationError} from '@/lib/integrations/http';
import {validateRecognitionImage} from '@/lib/server/recognition-image';
import {recognitionFingerprint,recognizeCached} from '@/lib/server/recognition-cache';
export const runtime='nodejs';
export const maxDuration=45;
export async function GET(){return Response.json({service:'Spendly recognition',status:'reachable'},{headers:{'Cache-Control':'no-store'}});}
const schema=z.object({text:z.string().trim().min(1).max(1500).optional(),imageBase64:z.string().max(5_600_000).optional(),mimeType:z.enum(['image/jpeg','image/png','image/webp']).optional()}).strict();
// Recognition reads no financial state and does not acquire the financial mutation lock.
export const POST=route(async request=>{
  const started=performance.now();
  const {userId}=await requireAuth(request);
  const requestId=randomUUID();
  const fail=(status:'BACKEND_ERROR'|'GEMINI_ERROR',code:string,error:string,httpStatus:number)=>{
    console.info('[recognition.backend]',{requestId,status,code,httpStatus,totalRecognitionMs:Math.round(performance.now()-started)});
    return Response.json({status,code,error,requestId},{status:httpStatus});
  };
  let input;
  let imageMetadata={imageByteLength:0,imageWidth:0,imageHeight:0,imageMimeType:'text'};
  try{
    input=schema.parse(await limitedJson(request,5_700_000));
    if(input.imageBase64 && input.mimeType)imageMetadata=await validateRecognitionImage(input.imageBase64,input.mimeType);
    else if(input.imageBase64 || input.mimeType || !input.text)throw new Error('INVALID_INPUT');
  }catch{return fail('BACKEND_ERROR','GEMINI_INVALID_IMAGE','The photo could not be read. Try another JPG, PNG, or WebP photo, or enter the item manually.',400);}
  const backendReceiveMs=Math.round(performance.now()-started);
  console.info('[recognition.backend]',{requestId,...imageMetadata,backendReceiveMs,sourceType:input.imageBase64?'image':'text',uploadBodyType:'json-base64'});
  let geminiRequestMs=0,geminiParseMs=0;
  try{
    const key=recognitionFingerprint(input,userId,process.env.GEMINI_MODEL??DEFAULT_GEMINI_MODEL);
    const {result,cacheHit}=await recognizeCached(key,()=>scanProduct(input,undefined,{skipCatalog:true,onTiming:timing=>{geminiRequestMs=timing.geminiRequestMs;geminiParseMs=timing.geminiParseMs;}}));
    const timings={backendReceiveMs,geminiRequestMs,geminiParseMs,totalRecognitionMs:Math.round(performance.now()-started),cacheHit};
    console.info('[recognition.backend]',{requestId,status:result.status,code:result.status==='NO_MATCH'?'GEMINI_NO_MATCH':undefined,candidateCount:result.candidates.length,...timings});
    return Response.json({...result,requestId,timings},{headers:{'Server-Timing':`receive;dur=${backendReceiveMs},gemini;dur=${geminiRequestMs},parse;dur=${geminiParseMs}`}});
  }catch(error){
    if(error instanceof IntegrationError && error.service==='Gemini'){
      const code=geminiCode(error);
      const message=code==='GEMINI_TIMEOUT'?'Scanning took too long. Try again or enter the item manually.':code==='GEMINI_RATE_LIMIT'?'Photo scanning is busy right now. Try again shortly or enter the item manually.':code==='GEMINI_PARSE_ERROR'?'We could not read the product details. Try another photo or enter the item manually.':'Photo scanning could not connect. Try again or enter the item manually.';
      return fail('GEMINI_ERROR',code,message,502);
    }
    return fail('BACKEND_ERROR','UNEXPECTED_RESPONSE','The photo could not be analyzed. Try again or enter the item manually.',500);
  }
});
function geminiCode(error:IntegrationError){
  if(error.code==='timeout')return 'GEMINI_TIMEOUT';
  if(error.code==='invalid-response')return 'GEMINI_PARSE_ERROR';
  if(error.status===401||error.status===403||error.code==='configuration')return 'GEMINI_AUTH_ERROR';
  if(error.status===429)return 'GEMINI_RATE_LIMIT';
  if(error.status===400)return 'GEMINI_INVALID_IMAGE';
  if(error.code==='network')return 'GEMINI_NETWORK_ERROR';
  return 'GEMINI_ERROR';
}
