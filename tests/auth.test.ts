import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {SignJWT} from 'jose';
import {accessToken,verifyAccessToken,hashPassword,verifyPassword,randomToken,tokenHash} from '../src/lib/server/auth/crypto';
import {registerSchema} from '../src/types/auth';
import {createAuthenticatedFetch,ApiError} from '../src/lib/auth/authenticated-fetch';
import {providerEnvironment} from '../src/lib/server/auth/integrations';

process.env.JWT_ACCESS_SECRET='test-access-secret-with-at-least-32-bytes';
process.env.JWT_REFRESH_SECRET='test-refresh-secret-with-at-least-32-bytes';
test('passwords use Argon2id and registration validates and normalizes input',async()=>{
  const hash=await hashPassword('a strong test password');
  assert.match(hash,/^\$argon2id\$/);
  assert.equal(await verifyPassword('a strong test password',hash),true);
  assert.equal(await verifyPassword('wrong',hash),false);
  assert.equal(registerSchema.parse({name:' Person ',email:' Person@Example.com ',password:'long-password'}).email,'person@example.com');
  for(const input of [{name:'',email:'bad',password:'short'},{name:'Person',email:'valid@example.com',password:'short'}])assert.equal(registerSchema.safeParse(input).success,false);
  const token=randomToken();assert.equal(token.length,64);assert.notEqual(tokenHash(token),token);assert.notEqual(tokenHash(token),tokenHash(token,'reset'));
});
test('access JWT verifies identity, expiry, signature, and expected algorithm',async()=>{
  const user=randomUUID(),session=randomUUID();
  assert.deepEqual(await verifyAccessToken(await accessToken(user,session)),{userId:user,sessionId:session});
  await assert.rejects(verifyAccessToken(await accessToken(user,session,-1)));
  const invalid=await new SignJWT({sub:user,jti:session}).setProtectedHeader({alg:'HS384'}).setIssuer('canibuyit').setAudience('canibuyit-app').setIssuedAt().setExpirationTime('15m').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));
  await assert.rejects(verifyAccessToken(invalid));
  const token=await accessToken(user,session);const parts=token.split('.');parts[2]=(parts[2][0]==='a'?'b':'a')+parts[2].slice(1);
  await assert.rejects(verifyAccessToken(parts.join('.')));
});
test('authenticated client refreshes once and retries with the new bearer',async()=>{
  let calls=0,refreshes=0,clears=0;
  const client=createAuthenticatedFetch(()=> 'old',async()=>{refreshes++;return 'new';},async()=>{clears++;},async(_url,init)=>{
    calls++;assert.equal(new Headers(init?.headers).get('Authorization'),calls===1?'Bearer old':'Bearer new');
    return calls===1?Response.json({code:'ACCESS_EXPIRED'},{status:401}):Response.json({ok:true});
  });
  assert.equal((await client('http://api/test')).status,200);assert.equal(calls,2);assert.equal(refreshes,1);assert.equal(clears,0);
});
test('rejected sessions clear auth without infinite refresh loops; offline refresh preserves credentials',async()=>{
  for(const code of ['SESSION_REVOKED','ACCESS_EXPIRED']){
    let refreshes=0,clears=0,calls=0;let token='old';
    const client=createAuthenticatedFetch(()=>token,async()=>{refreshes++;token='new';return token;},async()=>{clears++;},async()=>{calls++;return Response.json({code},{status:401});});
    assert.equal((await client('http://api/test')).status,401);assert.equal(refreshes,code==='ACCESS_EXPIRED'?1:0);assert.equal(calls,refreshes+1);assert.equal(clears,1);
  }
  let cleared=false;
  const client=createAuthenticatedFetch(()=> 'old',async()=>{throw new ApiError(0,'Offline');},async()=>{cleared=true;},async()=>Response.json({code:'ACCESS_EXPIRED'},{status:401}));
  await assert.rejects(client('http://api/test'),/Offline/);assert.equal(cleared,false);
});
test('an unmapped authenticated user never inherits the global demo banking identity',()=>{
  const env=providerEnvironment({nessie_customer_id:null,nessie_checking_account_id:null,backboard_assistant_id:null});
  assert.equal(env.NESSIE_CUSTOMER_ID,'');assert.equal(env.NESSIE_ACCOUNT_ID,'');assert.equal(env.NESSIE_API_KEY,undefined);
});

test('a late response from a revoked old session cannot clear a newer session',async()=>{
  let token='old',calls=0,clears=0;
  const client=createAuthenticatedFetch(()=>token,async()=>{throw new Error('Unexpected refresh');},async()=>{clears++;},async(_url,init)=>{
    calls++;if(calls===1){token='new';return Response.json({code:'SESSION_REVOKED'},{status:401});}
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer new');return Response.json({ok:true});
  });
  assert.equal((await client('http://api/test')).status,200);assert.equal(clears,0);assert.equal(calls,2);
});
