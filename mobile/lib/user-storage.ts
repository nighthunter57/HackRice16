import AsyncStorage from '@react-native-async-storage/async-storage';
const pending=new Map<string,Promise<void>>();
const deleted=new Set<string>();
function enqueue(key:string,run:()=>Promise<void>){
  const next=(pending.get(key)??Promise.resolve()).catch(()=>{}).then(run);
  pending.set(key,next);
  void next.finally(()=>{if(pending.get(key)===next)pending.delete(key);}).catch(()=>{});
  return next;
}
export function writeUserData(key:string,value:string){
  return enqueue(key,async()=>{if(!deleted.has(key))await AsyncStorage.setItem(key,value);});
}
/** Removal runs after prior writes; late writes cannot recreate a deleted account's data. */
export async function removeUserData(userId:string){
  const keys=[`canibuyit.mobile.history.v1:${userId}`,`canibuyit.mobile.settings.v1:${userId}`];
  for(const key of keys)deleted.add(key);
  await Promise.all(keys.map(key=>enqueue(key,()=>AsyncStorage.removeItem(key))));
}
