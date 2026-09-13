import {z} from 'zod';
import {route,requireAuth,body} from '@/lib/server/auth/http';
import {lookupBarcode} from '@/lib/integrations/product-search';
export {OPTIONS} from '@/lib/server/auth/http';
export const runtime='nodejs';
export const POST=route(async request=>{
  await requireAuth(request);
  const {barcode}=await body(request,z.object({barcode:z.string().regex(/^(?:\d{8}|\d{12,14})$/)}).strict());
  const key=process.env.UPCITEMDB_API_KEY;
  if(!key)return Response.json({candidates:[],message:'No catalog is connected. You can enter the price yourself.'});
  try{return Response.json({candidates:await lookupBarcode(barcode,key)});}
  catch{return Response.json({candidates:[],message:'Catalog lookup could not connect. You can still enter the price yourself.'});}
});
