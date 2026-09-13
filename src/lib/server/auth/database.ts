import { Pool, type PoolClient } from 'pg';
import { tigerPoolConfig } from '../../integrations/tiger-config';
let pool:Pool|undefined;
let locks:Pool|undefined;
// Lock waiters must not consume the connections needed by authenticated handlers.
export function userLockDatabase() {
  const config=tigerPoolConfig();
  if(!config)throw new Error("Authentication database is not configured.");
  return locks??=new Pool(config);
}
export function authDatabase() {
  const config=tigerPoolConfig();
  if(!config) throw new Error('Authentication database is not configured.');
  return pool??=new Pool(config);
}
export async function transaction<T>(run:(db:PoolClient)=>Promise<T>):Promise<T> {
  const db=await authDatabase().connect();
  try {await db.query('BEGIN');const result=await run(db);await db.query('COMMIT');return result;}
  catch(error){await db.query('ROLLBACK');throw error;}
  finally{db.release();}
}
export async function closeAuthDatabase(){if(pool){await pool.end();pool=undefined;}if(locks){await locks.end();locks=undefined;}}
