import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { userSchema, type AuthTokens, type AuthUser } from '../../../types/auth';
import { authDatabase, transaction } from './database';
import { accessToken, dummyPasswordHash, hashPassword, randomToken, tokenHash, ttl, verifyPassword } from './crypto';
import { AuthError } from './errors';
import { sendPasswordResetEmail, resetDeliveryAvailable } from './email';
const rowSchema=z.object({id:z.string().uuid(),name:z.string(),email:z.string(),password_hash:z.string(),created_at:z.coerce.date()});
export const sanitizedUser=(row:unknown)=>{const r=rowSchema.parse(row);return userSchema.parse({id:r.id,name:r.name,email:r.email,createdAt:r.created_at.toISOString()});};
async function newSession(db:PoolClient,user:AuthUser):Promise<AuthTokens> {
  const id=randomUUID(),refreshToken=randomToken();
  const token=await accessToken(user.id,id);
  await db.query("INSERT INTO auth_sessions(id,user_id,refresh_token_hash,expires_at) VALUES($1,$2,$3,now()+$4::int*interval '1 day')",[id,user.id,tokenHash(refreshToken),ttl('REFRESH_TOKEN_TTL_DAYS',7,30)]);
  return {user,accessToken:token,refreshToken};
}
export async function register(input:{name:string;email:string;password:string}) {
  const password=await hashPassword(input.password);
  try{return await transaction(async db=>{
    const row=(await db.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4) RETURNING *',[randomUUID(),input.name,input.email,password])).rows[0];
    const user=sanitizedUser(row);
    await db.query('INSERT INTO user_integrations(user_id) VALUES($1)',[user.id]);
    return newSession(db,user);
  });}catch(error){if(error && typeof error==='object' && 'code' in error && error.code==='23505')throw new AuthError(409,'An account with this email already exists.');throw error;}
}
export async function login(input:{email:string;password:string}) {
  return transaction(async db=>{
    const raw=(await db.query('SELECT * FROM users WHERE email=$1 FOR UPDATE',[input.email])).rows[0];
    const row=raw?rowSchema.parse(raw):null;
    const valid=await verifyPassword(input.password,row?.password_hash??await dummyPasswordHash());
    if(!row || !valid) throw new AuthError(401,'Invalid email or password.');
    return newSession(db,sanitizedUser(row));
  });
}
export async function refresh(refreshToken:string) {
  return transaction(async db=>{
    const hash=tokenHash(refreshToken);
    const row=(await db.query('SELECT u.* FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE s.refresh_token_hash=$1 FOR UPDATE OF u',[hash])).rows[0];
    if(!row) throw new AuthError(401,'Your session has expired. Please sign in again.');
    const next=randomToken();
    const result=await db.query('UPDATE auth_sessions SET refresh_token_hash=$1 WHERE user_id=$2 AND refresh_token_hash=$3 AND revoked_at IS NULL AND expires_at>now() RETURNING id',[tokenHash(next),sanitizedUser(row).id,hash]);
    if(!result.rows[0]) throw new AuthError(401,'Your session has expired. Please sign in again.');
    const session=z.object({id:z.string().uuid()}).parse(result.rows[0]);
    return {user:sanitizedUser(row),accessToken:await accessToken(sanitizedUser(row).id,session.id),refreshToken:next};
  });
}
export async function logout(userId:string,sessionId:string){await authDatabase().query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2',[sessionId,userId]);}
export async function getUser(userId:string){const row=(await authDatabase().query('SELECT * FROM users WHERE id=$1',[userId])).rows[0];if(!row)throw new AuthError(401,'Please sign in again.');return sanitizedUser(row);}
export async function updateName(userId:string,name:string){return sanitizedUser((await authDatabase().query('UPDATE users SET name=$1,updated_at=now() WHERE id=$2 RETURNING *',[name,userId])).rows[0]);}
export async function forgotPassword(email:string,deliver=sendPasswordResetEmail) {
  if(deliver===sendPasswordResetEmail && !resetDeliveryAvailable()) {
    console.info('[auth.email]',{status:'not-configured'});
    return {message:'If an account exists for this email, reset instructions have been sent.'};
  }
  const token=randomToken();
  const issued=await transaction(async db=>{
    const user=(await db.query('SELECT id FROM users WHERE email=$1 FOR UPDATE',[email])).rows[0];
    if(!user)return false;
    const id=z.object({id:z.string().uuid()}).parse(user).id;
    await db.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',[id]);
    await db.query("INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+$4::int*interval '1 minute')",[randomUUID(),id,tokenHash(token,'reset'),ttl('PASSWORD_RESET_TOKEN_TTL_MINUTES',15,60)]);
    return true;
  });
  if(issued)try{await deliver(email,token);}catch{console.info('[auth.email]',{status:'delivery-failed'});}
  return {message:'If an account exists for this email, reset instructions have been sent.'};
}
export async function resetPassword(token:string,newPassword:string) {
  const hash=tokenHash(token,'reset');
  await transaction(async db=>{
    const raw=(await db.query('SELECT u.id FROM users u JOIN password_reset_tokens r ON r.user_id=u.id WHERE r.token_hash=$1 FOR UPDATE OF u',[hash])).rows[0];
    if(!raw)throw new AuthError(400,'This reset link is invalid or expired. Request a new one.');
    const userId=z.object({id:z.string().uuid()}).parse(raw).id;
    const valid=await db.query('UPDATE password_reset_tokens SET used_at=now() WHERE token_hash=$1 AND user_id=$2 AND used_at IS NULL AND expires_at>now() RETURNING id',[hash,userId]);
    if(!valid.rowCount)throw new AuthError(400,'This reset link is invalid or expired. Request a new one.');
    await db.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2',[await hashPassword(newPassword),userId]);
    await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1',[userId]);
    await db.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',[userId]);
  });
  return {message:'Password updated. Please sign in.'};
}
export async function changePassword(userId:string,currentPassword:string,newPassword:string) {
  return transaction(async db=>{
    const row=rowSchema.parse((await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0]);
    if(!await verifyPassword(currentPassword,row.password_hash))throw new AuthError(400,'Your current password is incorrect.');
    await db.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2',[await hashPassword(newPassword),userId]);
    await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1',[userId]);
    await db.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',[userId]);
    return newSession(db,sanitizedUser(row));
  });
}
