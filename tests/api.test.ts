import {allowedOrigin,requireAuth} from '../src/lib/server/auth/http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisInputSchema, buildDashboard } from '../src/lib/server/dashboard';
import { limitedJson } from '../src/lib/server/request';
import { demoPurchase } from '../src/data/demo-profile';

test('validated demo API pipeline recomputes causal Safe Date change and preserves cents',async()=>{
  const input=analysisInputSchema.parse({purchase:demoPurchase,repair:true});
  const result=await buildDashboard(input,false);
  assert.equal(result.change?.previousSafeDate,'2026-09-17'); assert.equal(result.change?.newSafeDate,'2026-09-24');
  assert.equal(result.change?.differenceDays,7); assert.equal(result.change?.causes[0].amountCents,43_000);
  assert.ok(result.services.every(service=>service.mode!=='live'));
});
test('API boundary rejects fractional cents, negative prices and unsupported horizons',()=>{
  for(const priceCents of [-1,1.2,Number.MAX_SAFE_INTEGER]) assert.equal(analysisInputSchema.safeParse({purchase:{...demoPurchase,priceCents}}).success,false);
  for(const horizonDays of [0,29,91,Infinity]) assert.equal(analysisInputSchema.safeParse({purchase:demoPurchase,horizonDays}).success,false);
});
test('origin policy rejects unknown sites and static credentials cannot authenticate',async()=>{
  assert.equal(allowedOrigin(new Request('http://localhost/api',{headers:{origin:'https://elsewhere.example'}})),false);
  assert.equal(allowedOrigin(new Request('http://localhost/api')),true);
  assert.equal(allowedOrigin(new Request('http://localhost/api',{headers:{origin:'http://localhost'}})),true);
  await assert.rejects(requireAuth(new Request('http://localhost/api')),/sign in/);
  await assert.rejects(requireAuth(new Request('http://localhost/api',{headers:{authorization:'Bearer old-shared-token'}})),/sign in/);
});
test('JSON request reader enforces real payload size rather than trusting Content-Length',async()=>{
  const request=new Request('http://localhost/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'x'.repeat(100)})});
  await assert.rejects(limitedJson(request,20));
  const valid=new Request('http://localhost/api',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"value":1}'});
  assert.deepEqual(await limitedJson(valid),{value:1});
});
