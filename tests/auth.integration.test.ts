import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {authDatabase,closeAuthDatabase} from '../src/lib/server/auth/database';
import * as auth from '../src/lib/server/auth/service';
import {deleteAccount} from '../src/lib/server/auth/deletion';
import {requireAuth,rateLimit} from '../src/lib/server/auth/http';
import {accessToken,verifyAccessToken,tokenHash,randomToken} from '../src/lib/server/auth/crypto';
import {POST as authPost} from '../src/app/api/auth/[action]/route';
import {POST as analyzePost} from '../src/app/api/analyze/route';
import {GET as preferencesGet,POST as preferencesPost} from '../src/app/api/preferences/route';
import {GET as meGet,DELETE as meDelete} from '../src/app/api/me/route';
import {demoPurchase} from '../src/data/demo-profile';
import {readSnapshotById} from '../src/lib/integrations/tiger-analytics';
import {demoProfile} from '../src/data/demo-profile';
import {ownedState} from '../src/lib/finance/ownership';
import {settingsFor} from '../src/lib/finance/settings';

// Explicit opt-in: creates and removes only unique test-owned rows in a migrated development database.
test('PostgreSQL authentication lifecycle and financial isolation',{skip:process.env.AUTH_INTEGRATION_TESTS!=='true'},async t=>{
  const suffix=randomUUID();const email=`auth-test-${suffix}@example.invalid`;const password='test password long enough';
  const db=authDatabase();const ids:string[]=[];
  const request=(path:string,token?:string,payload?:unknown,method=payload===undefined?'GET':'POST')=>new Request(`http://localhost${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
  try {
    const a=await auth.register({name:'Auth Test A',email,password});ids.push(a.user.id);
    const b=await auth.register({name:'Auth Test B',email:`b-${email}`,password});ids.push(b.user.id);
    await t.test('registration auto-login, sanitized profile, duplicate rejection',async()=>{
      assert.deepEqual(Object.keys(a.user).sort(),['createdAt','email','id','name']);
      assert.match((await db.query('SELECT password_hash FROM users WHERE id=$1',[a.user.id])).rows[0].password_hash,/^\$argon2id\$/);
      assert.equal((await requireAuth(request('/api/me',a.accessToken))).userId,a.user.id);
      await assert.rejects(auth.register({name:'Duplicate',email,password}),{status:409});
    });
    await t.test('valid login and generic errors for missing user/wrong password',async()=>{
      assert.equal((await auth.login({email,password})).user.id,a.user.id);
      for(const input of [{email,password:'wrong'}, {email:`missing-${email}`,password}])await assert.rejects(auth.login(input),{status:401,message:'Invalid email or password.'});
    });
    await t.test('access expiry and rotating hashed refresh token',async()=>{
      const identity=await verifyAccessToken(a.accessToken);
      const expired=await accessToken(a.user.id,identity.sessionId,-1);
      await assert.rejects(requireAuth(request('/api/me',expired)),{code:'ACCESS_EXPIRED'});
      const renewed=await auth.refresh(a.refreshToken);assert.notEqual(renewed.refreshToken,a.refreshToken);
      assert.equal((await requireAuth(request('/api/me',renewed.accessToken))).userId,a.user.id);
      const row=(await db.query('SELECT refresh_token_hash FROM auth_sessions WHERE id=$1',[identity.sessionId])).rows[0];
      assert.equal(row.refresh_token_hash,tokenHash(renewed.refreshToken));assert.notEqual(row.refresh_token_hash,renewed.refreshToken);
      await assert.rejects(auth.refresh(a.refreshToken),{status:401});await assert.rejects(auth.refresh(randomToken()),{status:401});
      await db.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[identity.sessionId]);
      await assert.rejects(auth.refresh(renewed.refreshToken),{status:401});
    });
    await t.test('logout revokes refresh and access immediately',async()=>{
      const login=await auth.login({email,password});const identity=await verifyAccessToken(login.accessToken);
      await auth.logout(a.user.id,identity.sessionId);
      await assert.rejects(auth.refresh(login.refreshToken),{status:401});
      await assert.rejects(requireAuth(request('/api/me',login.accessToken)),{code:'SESSION_REVOKED'});
    });
    await t.test('forgot-password is generic, tokens expire and previous links are invalidated',async()=>{
      const captured:string[]=[];const deliver=async(_email:string,token:string)=>{captured.push(token);};
      const known=await auth.forgotPassword(email,deliver);const unknown=await auth.forgotPassword(`missing-${email}`,deliver);
      assert.deepEqual(known,unknown);assert.equal(captured.length,1);
      await auth.forgotPassword(email,deliver);
      await assert.rejects(auth.resetPassword(captured[0],'another long password'),{status:400});
      await db.query("UPDATE password_reset_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[tokenHash(captured[1],'reset')]);
      await assert.rejects(auth.resetPassword(captured[1],'another long password'),{status:400});
    });
    await t.test('reset is single-use and revokes all existing sessions',async()=>{
      const old=await auth.login({email,password});let token='';
      await auth.forgotPassword(email,async(_email,issued)=>{token=issued;});
      assert.equal((await db.query('SELECT token_hash FROM password_reset_tokens WHERE token_hash=$1',[tokenHash(token,'reset')])).rowCount,1);
      await auth.resetPassword(token,'replacement password');
      await assert.rejects(auth.resetPassword(token,'another replacement'),{status:400});
      await assert.rejects(auth.refresh(old.refreshToken),{status:401});await assert.rejects(auth.login({email,password}),{status:401});
      assert.equal((await auth.login({email,password:'replacement password'})).user.id,a.user.id);
    });
    await t.test('change password checks current secret and retains only the new session',async()=>{
      const old=await auth.login({email,password:'replacement password'});
      await assert.rejects(auth.changePassword(a.user.id,'wrong','new long password'),{status:400});
      const changed=await auth.changePassword(a.user.id,'replacement password','new long password');
      await assert.rejects(auth.refresh(old.refreshToken),{status:401});assert.equal((await requireAuth(request('/api/me',changed.accessToken))).userId,a.user.id);
    });
    const active=await auth.login({email,password:'new long password'});
    await t.test('financial endpoints reject anonymous and caller-supplied identity',async()=>{
      assert.equal((await analyzePost(request('/api/analyze',undefined,{purchase:demoPurchase}))).status,401);
      const stolen=settingsFor(ownedState(demoProfile(),b.user.id),'demo');
      assert.equal((await analyzePost(request('/api/analyze',active.accessToken,{purchase:demoPurchase,settings:stolen,mode:'demo'}))).status,403);
      const response=await meGet(request(`/api/me?userId=${b.user.id}`,active.accessToken));assert.equal((await response.json()).id,a.user.id);
    });
    await t.test('preferences and financial snapshots are scoped to the authenticated owner',async()=>{
      assert.equal((await preferencesPost(request('/api/preferences',active.accessToken,{key:'spendingPriority',value:'saving'}))).status,200);
      assert.deepEqual((await (await preferencesGet(request('/api/preferences',b.accessToken))).json()).preferences,[]);
      const snapshotId=randomUUID();
      await db.query('INSERT INTO financial_snapshots(id,user_id,source,state) VALUES($1,$2,$3,$4)',[snapshotId,b.user.id,'demo',ownedState(demoProfile(),b.user.id)]);
      const stolen=await readSnapshotById(snapshotId,{db,userId:a.user.id});assert.equal(stolen.mode,'live');if(stolen.mode==='live')assert.equal(stolen.data,null);
      const response=await analyzePost(request('/api/analyze',active.accessToken,{purchase:demoPurchase,mode:'demo'}));assert.equal(response.status,200);
      const result=await response.json();assert.equal(result.profile.userId,a.user.id);assert.equal(result.dataSource,'demo');
      assert.ok(result.preferences.some((p:string)=>p.includes('prioritize saving')));
    });
    await t.test('browser refresh is HttpOnly and CORS is explicit',async()=>{
      const response=await authPost(new Request('http://localhost/api/auth/login',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({email,password:'new long password'})}));
      assert.equal(response.status,200);assert.match(response.headers.get('Set-Cookie')??'',/HttpOnly; SameSite=Strict/);assert.equal((await response.json()).refreshToken,undefined);
      assert.equal((await authPost(new Request('http://localhost/api/auth/login',{method:'POST',headers:{Origin:'https://evil.example'}}))).status,403);
    });
    await t.test('rate limit enforces a bounded number of attempts',async()=>{
      const req=request('/api/auth/login');const action=`test-${suffix}`;
      await rateLimit(req,action,email,1);await assert.rejects(rateLimit(req,action,email,1),{status:429});
      await db.query('DELETE FROM auth_rate_limits WHERE key_hash=ANY($1::text[])',[[tokenHash(`ip:shared:${action}`,'rate'),tokenHash(`identity:${action}:${email}`,'rate')]]);
    });
    await t.test('deletion requires confirmation and removes only authenticated app data',async()=>{
      assert.equal((await meDelete(request('/api/me',active.accessToken,{confirmation:'DELETE',userId:b.user.id},'DELETE'))).status,400);
      for(const id of ids){await db.query("INSERT INTO financial_events(time,event_id,user_id,amount_cents,event_type) VALUES(now()-interval '2 days',$1,$2,-100,'purchase')",[`auth-test-${id}`,id]);await db.query('INSERT INTO purchase_decisions(id,user_id,decision) VALUES($1,$2,$3)',[randomUUID(),id,{test:true}]);}
      const result=await meDelete(request(`/api/me?userId=${b.user.id}`,active.accessToken,{confirmation:'DELETE'},'DELETE'));assert.equal(result.status,200,JSON.stringify(await result.json()));
      for(const table of ['users','auth_sessions','password_reset_tokens','user_integrations','user_preferences','financial_events','financial_snapshots','purchase_decisions']){
        const key=table==='users'?'id':'user_id';assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE ${key}=$1`,[a.user.id])).rowCount,0);
      }
      assert.equal((await auth.getUser(b.user.id)).id,b.user.id);assert.equal((await db.query('SELECT 1 FROM financial_events WHERE user_id=$1',[b.user.id])).rowCount,1);
      await assert.rejects(requireAuth(request('/api/me',active.accessToken)),{code:'SESSION_REVOKED'});
    });
  } finally {
    for(const id of ids)await deleteAccount(id);
    await closeAuthDatabase();
  }
});
