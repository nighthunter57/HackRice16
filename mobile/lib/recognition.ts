import { scanFailureSchema, scanResultSchema,scanCandidateSchema } from '../../src/types/scan';
import {z} from 'zod';
import { prepareScanImage } from '../../src/types/scan-image';

export class ScanRequestError extends Error {
  constructor(readonly status:'NETWORK_ERROR'|'BACKEND_ERROR'|'GEMINI_ERROR',readonly code:string,message:string,readonly requestId?:string) {super(message);}
}

/** Optional lookup runs after vision has rendered; it never starts financial analysis. */
export async function requestBarcodeLookup(barcode:string,url:string,fetcher:typeof fetch){
  const response=await fetcher(`${url.replace(/\/$/,'')}/api/product-lookup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({barcode}),signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error('Catalog lookup could not connect. Enter the price yourself.');
  return z.object({candidates:z.array(scanCandidateSchema).max(5),message:z.string().optional()}).parse(await response.json());
}

export async function requestRecognition(base64:string,url:string,token:string,signal:AbortSignal,fetcher:typeof fetch=fetch) {
  let input;
  try {input=prepareScanImage(base64);}
  catch {throw new ScanRequestError('BACKEND_ERROR','INVALID_IMAGE','Choose a JPG, PNG, or WebP image under 4 MB.');}
  let response:Response;
  try {
    response=await fetcher(`${url.replace(/\/$/,'')}/api/extract`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ })},body:JSON.stringify(input),signal});
  } catch {
    throw new ScanRequestError('NETWORK_ERROR',signal.aborted?'TIMEOUT':'UNREACHABLE','Cannot reach recognition. Check the backend address and Wi-Fi, or enter the item manually.');
  }
  let payload:unknown;
  try {payload=await response.json();}
  catch {throw new ScanRequestError('BACKEND_ERROR','INVALID_RESPONSE','The backend returned an unreadable response. Enter the item manually.');}
  if(!response.ok) {
    const error=scanFailureSchema.safeParse(payload);
    if(error.success) throw new ScanRequestError(error.data.status,error.data.code,error.data.error,error.data.requestId);
    throw new ScanRequestError('BACKEND_ERROR',`HTTP_${response.status}`,response.status===401?'Please sign in again to scan a product.':'Recognition is unavailable right now. Enter the product and price below.');
  }
  const result=scanResultSchema.safeParse(payload);
  if(!result.success) throw new ScanRequestError('BACKEND_ERROR','INVALID_RESPONSE','The backend returned invalid product details. Enter the item manually.');
  return result.data;
}
