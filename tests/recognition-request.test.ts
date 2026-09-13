import test from 'node:test';
import assert from 'node:assert/strict';
import { requestRecognition, ScanRequestError } from '../mobile/lib/recognition';
import { prepareScanImage } from '../src/types/scan-image';
import { recognitionSchema,mergeCatalogMatches } from '../src/types/scan';
import { scanProduct } from '../src/lib/server/scan';
import { recognizeProducts } from '../src/lib/integrations/gemini';
import {validateRecognitionImage} from '../src/lib/server/recognition-image';
import {recognitionFingerprint,recognizeCached} from '../src/lib/server/recognition-cache';
import sharp from 'sharp';

const candidate={productName:'Headphones',brand:null,category:'electronics',confidence:0.6,searchQuery:'headphones',evidence:'visual' as const};
const recognition={barcode:null,visibleText:'',productFamily:'Headphones',visiblePriceCents:null,candidates:[candidate]};
const jpeg='/9j/AAAA';
test('near-limit image validation does not overflow the regex stack and enforces decoded size',()=>{
  assert.equal(prepareScanImage('/9j/'+'A'.repeat(5_499_996)).mimeType,'image/jpeg');
  assert.throws(()=>prepareScanImage('/9j/'+'A'.repeat(5_600_000)),/INVALID_IMAGE/);
  assert.equal(prepareScanImage('iVBORw0KGgo=').mimeType,'image/png');
  assert.equal(prepareScanImage(Buffer.from('RIFF1234WEBP').toString('base64')).mimeType,'image/webp');
  assert.throws(()=>prepareScanImage('YWJj'),/UNSUPPORTED_IMAGE/);
});
test('partial visual results remain usable',()=>{
  const partial=recognitionSchema.parse({candidates:[{productName:'AirPods',confidence:.8,searchQuery:'Apple AirPods',evidence:'visual'}]});
  assert.equal(partial.productFamily,undefined);assert.equal(partial.visiblePriceCents,undefined);assert.equal(partial.candidates[0].category,undefined);
});
test('recognition separates product-only, full success, and no match without fabricating prices',async()=>{
  const run=(value:typeof recognition)=>scanProduct({text:'headphones'},{recognize:async()=>value,lookup:async()=>[],catalogKey:undefined});
  assert.equal((await run(recognition)).status,'PRODUCT_ONLY');
  assert.equal((await scanProduct({text:'headphones'},{recognize:async()=>({...recognition,visiblePriceCents:44900}),lookup:async()=>[],catalogKey:undefined})).status,'FULL_SUCCESS');
  assert.equal((await run({...recognition,candidates:[]})).status,'NO_MATCH');
});
test('mobile distinguishes network, backend, Gemini failures and validates successful candidates',async()=>{
  const run=(fetcher:typeof fetch)=>requestRecognition(jpeg,'http://mac:3000','session-token',new AbortController().signal,fetcher);
  await assert.rejects(run(async()=>{throw new Error('secret network context');}),e=>e instanceof ScanRequestError && e.status==='NETWORK_ERROR' && !e.message.includes('secret'));
  await assert.rejects(run(async()=>new Response('not JSON',{status:500})),e=>e instanceof ScanRequestError && e.status==='BACKEND_ERROR');
  await assert.rejects(run(async()=>Response.json({status:'GEMINI_ERROR',code:'GEMINI_429',error:'Unavailable',requestId:'test'},{status:502})),e=>e instanceof ScanRequestError && e.status==='GEMINI_ERROR' && e.code==='GEMINI_429');
  const result=await scanProduct({text:'headphones'},{recognize:async()=>recognition,lookup:async()=>[],catalogKey:undefined});
  assert.equal((await run(async(url,init)=>{
    assert.equal(url,'http://mac:3000/api/extract');
    assert.equal(JSON.parse(String(init?.body)).mimeType,'image/jpeg');
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer session-token');
    return Response.json(result);
  })).status,'PRODUCT_ONLY');
});
test('Gemini request validates large supported base64 without stack overflow',async()=>{
  const result=await recognizeProducts({imageBase64:'/9j/'+'A'.repeat(5_499_996),mimeType:'image/jpeg'},{apiKey:'test',model:'gemini-2.5-flash',fetcher:async(_url,init)=>{
    assert.deepEqual(JSON.parse(String(init?.body)).generationConfig.thinkingConfig,{thinkingBudget:0});
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(recognition)}]}}]});
  }});
  assert.equal(result.visiblePriceCents,null);
});

test('cancelled or timed-out scan requests return a recoverable error without raw network details',async()=>{
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(requestRecognition(jpeg,'http://mac:3000','',controller.signal,async(_url,init)=>{
    assert.equal(init?.signal?.aborted,true);
    throw new Error('private network trace');
  }),error=>error instanceof ScanRequestError && error.code==='TIMEOUT' && !error.message.includes('private network trace'));
});

test('backend decodes real bytes and rejects MIME mismatches and truncated files',async()=>{
  const bytes=await sharp({create:{width:32,height:24,channels:3,background:'#f00'}}).jpeg().toBuffer();
  const metadata=await validateRecognitionImage(bytes.toString('base64'),'image/jpeg');
  assert.equal(metadata.imageByteLength,bytes.length);assert.equal(metadata.imageWidth,32);assert.equal(metadata.imageHeight,24);
  await assert.rejects(validateRecognitionImage(bytes.toString('base64'),'image/png'));
  await assert.rejects(validateRecognitionImage(bytes.subarray(0,120).toString('base64'),'image/jpeg'));
  await assert.rejects(validateRecognitionImage('file:///phone/photo.jpg','image/jpeg'));
});

test('partial family results become selectable and multi-object prices do not leak to other items',async()=>{
  const dependencies={recognize:async()=>recognitionSchema.parse({status:'PRODUCT_ONLY',productFamily:'Apple AirPods',confidence:.9,candidates:[]}),lookup:async()=>[],catalogKey:undefined};
  const family=await scanProduct({text:'item'},dependencies);
  assert.equal(family.status,'PRODUCT_ONLY');assert.equal(family.candidates[0].productName,'Apple AirPods');assert.equal(family.candidates[0].category,'other');
  const multiple=await scanProduct({text:'items'},{...dependencies,recognize:async()=>recognitionSchema.parse({visiblePriceCents:24900,candidates:[{productName:'AirPods',confidence:.9}],detectedProducts:[{label:'AirPods',confidence:.9},{label:'iPhone',confidence:.8}]})});
  assert.equal(multiple.status,'MULTIPLE_CANDIDATES');assert.equal(multiple.candidates.length,2);
  assert.ok(multiple.candidates.every(item=>item.priceCents===null));
});

test('scan fast path calls Gemini once and does not wait for catalog lookup',async()=>{
  let calls=0;
  const result=await scanProduct({text:'headphones'},{recognize:async()=>{calls++;return {...recognition,barcode:'123456789012'};},lookup:async()=>{throw new Error('Must not call catalog');},catalogKey:'configured'},{skipCatalog:true});
  assert.equal(calls,1);assert.equal(result.status,'PRODUCT_ONLY');assert.deepEqual(result.warnings,[]);
});

test('optional catalog enrichment fills missing prices but preserves visible prices',async()=>{
  const current=await scanProduct({text:'item'},{recognize:async()=>recognition,lookup:async()=>[],catalogKey:undefined});
  const offer={...current.candidates[0],priceCents:1200,priceSource:'catalog' as const};
  const enriched=mergeCatalogMatches(current,[offer]);
  assert.equal(enriched.status,'FULL_SUCCESS');assert.equal(enriched.candidates.length,1);assert.equal(enriched.candidates[0].priceCents,1200);
  const visible={...current,candidates:[{...current.candidates[0],priceCents:1500,priceSource:'visible' as const}]};
  assert.equal(mergeCatalogMatches(visible,[offer]).candidates[0].priceCents,1500);
  assert.equal(current.candidates[0].priceCents,null);
});

test('development cache scopes users/models, coalesces calls and never caches failure',async()=>{
  const key=recognitionFingerprint({text:'cache test'},'user-a','model-a');
  assert.notEqual(key,recognitionFingerprint({text:'cache test'},'user-b','model-a'));
  assert.notEqual(key,recognitionFingerprint({text:'cache test'},'user-a','model-b'));
  let calls=0;
  const run=async()=>{calls++;return scanProduct({text:'item'},{recognize:async()=>recognition,lookup:async()=>[],catalogKey:undefined});};
  const [first,second]=await Promise.all([recognizeCached(key,run,true),recognizeCached(key,run,true)]);
  assert.equal(calls,1);assert.equal(first.cacheHit,false);assert.equal(second.cacheHit,true);
  first.result.candidates[0].productName='changed';
  assert.equal((await recognizeCached(key,run,true)).result.candidates[0].productName,'Headphones');
  await recognizeCached(key,run,false);assert.equal(calls,2);
  await assert.rejects(recognizeCached('failed',async()=>{throw new Error('outage');},true));
  assert.equal((await recognizeCached('failed',run,true)).cacheHit,false);
});
