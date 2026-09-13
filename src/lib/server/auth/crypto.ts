import { randomBytes, createHmac } from 'node:crypto';
import * as argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
export function secret(name:'JWT_ACCESS_SECRET'|'JWT_REFRESH_SECRET') {
  const value=process.env[name];
  if(!value || Buffer.byteLength(value)<32) throw new Error('Authentication secrets must contain at least 32 bytes.');
  return value;
}
export function ttl(name:string,fallback:number,max:number) {
  return z.coerce.number().int().min(1).max(max).parse(process.env[name]??fallback);
}
export const randomToken=()=>randomBytes(48).toString('base64url');
export const tokenHash=(token:string,purpose='refresh')=>createHmac('sha256',secret('JWT_REFRESH_SECRET')).update(`${purpose}:${token}`).digest('hex');
export const hashPassword=(password:string)=>argon2.hash(password,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
export async function verifyPassword(password:string,hash:string) {try{return await argon2.verify(hash,password);}catch{return false;}}
let dummy:Promise<string>|undefined;
export function dummyPasswordHash(){return dummy??=hashPassword(randomToken());}
export async function accessToken(userId:string,sessionId:string,seconds=ttl('ACCESS_TOKEN_TTL_MINUTES',15,60)*60) {
  return new SignJWT({}).setProtectedHeader({alg:'HS256',typ:'JWT'}).setSubject(userId).setJti(sessionId)
    .setIssuer('canibuyit').setAudience('canibuyit-app').setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)+seconds)
    .sign(new TextEncoder().encode(secret('JWT_ACCESS_SECRET')));
}
export async function verifyAccessToken(token:string) {
  const {payload}=await jwtVerify(token,new TextEncoder().encode(secret('JWT_ACCESS_SECRET')),{algorithms:['HS256'],issuer:'canibuyit',audience:'canibuyit-app',requiredClaims:['sub','jti','exp','iat']});
  return {userId:z.string().uuid().parse(payload.sub),sessionId:z.string().uuid().parse(payload.jti)};
}
