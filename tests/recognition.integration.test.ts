import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {authDatabase,closeAuthDatabase,userLockDatabase} from '../src/lib/server/auth/database';
import {register} from '../src/lib/server/auth/service';
import {POST} from '../src/app/api/extract/route';
import {scanResultSchema} from '../src/types/scan';

// Real PostgreSQL auth/locking and image decoding; the external model is controlled.
test('authenticated scan forwards real bytes without waiting for financial work',{skip:process.env.AUTH_INTEGRATION_TESTS!=='true'},async()=>{
  const originalFetch=globalThis.fetch;
  let userId:string|undefined;
  try{
    const session=await register({name:'Recognition Test',email:`recognition-${randomUUID()}@example.invalid`,password:randomUUID()});
    userId=session.user.id;
    const bytes=await sharp({create:{width:48,height:32,channels:3,background:'#f00'}}).jpeg().toBuffer();
    const imageBase64=bytes.toString('base64');
    let calls=0;
    globalThis.fetch=async(url,init)=>{
      assert.ok(String(url).startsWith('https://generativelanguage.googleapis.com/'));
      const body=JSON.parse(String(init?.body));
      assert.equal(body.contents[0].parts[0].inlineData.data,imageBase64);
      assert.equal(body.contents[0].parts[0].inlineData.mimeType,'image/jpeg');
      assert.ok(body.contents[0].parts[1].text.includes('attached image'));
      calls++;
      return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({productFamily:'Headphones',confidence:.8,candidates:[]})}]}}]});
    };
    const request=(data:unknown,authenticated=true)=>new Request('http://localhost/api/extract',{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:`Bearer ${session.accessToken}`}:{})},body:JSON.stringify(data)});
    assert.equal((await POST(request({imageBase64,mimeType:'image/jpeg'},false))).status,401);
    const lock=await userLockDatabase().connect();
    let unlocked=false;
    await lock.query('SELECT pg_advisory_lock(hashtextextended($1,1))',[userId]);
    const timer=setTimeout(()=>{unlocked=true;void lock.query('SELECT pg_advisory_unlock(hashtextextended($1,1))',[userId]);},5000);
    try{
      const response=await POST(request({imageBase64,mimeType:'image/jpeg'}));
      assert.equal(unlocked,false,'Recognition waited for the financial lock');
      assert.equal(response.status,200);
      const result=scanResultSchema.parse(await response.json());
      assert.equal(result.status,'PRODUCT_ONLY');assert.equal(result.candidates[0].productName,'Headphones');
      assert.ok(result.timings);assert.ok(result.timings.totalRecognitionMs>=result.timings.backendReceiveMs);
      assert.equal(calls,1);
    }finally{
      clearTimeout(timer);
      if(!unlocked)await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,1))',[userId]);
      lock.release();
    }
    assert.equal((await POST(request({imageBase64:'/9j/AAAA',mimeType:'image/jpeg'}))).status,400);
    assert.equal(calls,1,'Invalid bytes reached Gemini');
    globalThis.fetch=async()=>new Response('',{status:429});
    const rateLimited=await POST(request({text:'different uncached product'}));
    assert.equal(rateLimited.status,502);assert.equal((await rateLimited.json()).code,'GEMINI_RATE_LIMIT');
  }finally{
    globalThis.fetch=originalFetch;
    if(userId)await authDatabase().query('DELETE FROM users WHERE id=$1',[userId]);
    await closeAuthDatabase();
  }
});
