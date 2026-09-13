import {login,logout} from '../src/lib/server/auth/service';
import {verifyAccessToken} from '../src/lib/server/auth/crypto';
import {closeAuthDatabase} from '../src/lib/server/auth/database';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseDashboard } from '../mobile/lib/api';
import { scanFailureSchema, scanResultSchema } from '../src/types/scan';
import type { Purchase } from '../src/types/finance';
async function main() {
  const url=process.env.VERIFY_API_URL??'http://127.0.0.1:3000';
  if(!process.env.VERIFY_AUTH_EMAIL || !process.env.VERIFY_AUTH_PASSWORD)throw new Error('Configure a dedicated verification account.');
  const session=await login({email:process.env.VERIFY_AUTH_EMAIL.trim().toLowerCase(),password:process.env.VERIFY_AUTH_PASSWORD});
  try {
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${session.accessToken}`};
  const image=readFileSync(process.argv[2]??'/tmp/canibuyit-price-tag.png').toString('base64');
  const scanResponse=await fetch(`${url}/api/extract`,{method:'POST',headers,body:JSON.stringify({imageBase64:image,mimeType:'image/png'}),signal:AbortSignal.timeout(50000)});
  console.info({scanHttpStatus:scanResponse.status});
  let purchase:Purchase={productName:'Headphones',priceCents:24900,category:'Electronics',purchaseType:'discretionary'};
  if(!scanResponse.ok) {
    const failure=scanFailureSchema.safeParse(await scanResponse.json());
    console.info({scanStatus:failure.success?failure.data.status:'unavailable',code:failure.success?failure.data.code:'unavailable',continuing:'manual purchase input'});
    process.exitCode=1;
  } else {
    const scan=scanResultSchema.parse(await scanResponse.json());
    assert.ok(scan.candidates.length>0);
    console.info({scanStatus:scan.status,candidates:scan.candidates.map(c=>({productName:c.productName,priceCents:c.priceCents,evidence:c.evidence}))});
    purchase={...purchase,productName:scan.candidates[0].productName,priceCents:scan.candidates[0].priceCents??24900};
  }
  const response=await fetch(`${url}/api/analyze`,{method:'POST',headers,body:JSON.stringify({purchase}),signal:AbortSignal.timeout(40000)});
  assert.equal(response.status,200);
  const dashboard=parseDashboard(await response.json(),purchase);
  assert.equal(dashboard.dataSource,'nessie');
  assert.equal(dashboard.immediateBalanceAfterPurchaseCents,dashboard.currentBalanceCents-purchase.priceCents);
  console.info({analysisHttpStatus:response.status,dataSource:dashboard.dataSource,currentBalanceCents:dashboard.currentBalanceCents,immediateBalanceAfterPurchaseCents:dashboard.immediateBalanceAfterPurchaseCents,refreshedAt:dashboard.refreshedAt,expenseEnabled:dashboard.developmentExpenseEnabled});
  } finally {const identity=await verifyAccessToken(session.accessToken);await logout(identity.userId,identity.sessionId);}
}
main().catch(()=>{console.error('Mobile API verification did not complete. No credentials or upstream payloads were logged.');process.exitCode=1;}).finally(closeAuthDatabase);
