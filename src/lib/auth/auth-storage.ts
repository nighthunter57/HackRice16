import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { z } from 'zod';
const key='canibuyit.auth.session.v1';
const schema=z.object({accessToken:z.string(),refreshToken:z.string()});
export type StoredTokens=z.infer<typeof schema>;
let writes:Promise<void>=Promise.resolve();
function enqueue(run:()=>Promise<void>){const next=writes.catch(()=>{}).then(run);writes=next;return next;}
export async function readTokens():Promise<StoredTokens|null> {
  if(Platform.OS==='web')return null; // Browser refresh tokens use an HttpOnly cookie.
  const raw=await SecureStore.getItemAsync(key);return raw?schema.parse(JSON.parse(raw)):null;
}
export async function storeTokens(tokens:StoredTokens){
  if(Platform.OS!=='web')await enqueue(()=>SecureStore.setItemAsync(key,JSON.stringify(tokens),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY}));
}
export async function clearTokens(){if(Platform.OS!=='web')await enqueue(()=>SecureStore.deleteItemAsync(key));}
