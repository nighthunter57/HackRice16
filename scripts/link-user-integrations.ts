import {z} from 'zod';
import {authDatabase,closeAuthDatabase} from '../src/lib/server/auth/database';
import {createNessieClient} from '../src/lib/nessie/client';
import {accountSchema,customerSchema} from '../src/lib/nessie/types';
import {emailSchema} from '../src/types/auth';

// Explicit operator setup, never called at registration or app startup.
async function main(){
  const args=process.argv.slice(2);
  if(!args.includes('--email'))throw new Error('Specify --email for an existing app account.');
  const email=emailSchema.parse(args[args.indexOf('--email')+1]);
  const db=authDatabase();
  const result=await db.query('SELECT id FROM users WHERE email=$1',[email]);
  if(!result.rowCount)throw new Error('Create the app account first.');
  const user=z.object({id:z.string().uuid()}).parse(result.rows[0]);
  if(args.includes('--nessie-demo')){
    const customerId=z.string().min(1).parse(process.env.NESSIE_CUSTOMER_ID);
    const accountId=z.string().min(1).parse(process.env.NESSIE_ACCOUNT_ID);
    const client=createNessieClient();
    await client.nessieGet(`/customers/${encodeURIComponent(customerId)}`,customerSchema);
    const account=await client.nessieGet(`/accounts/${encodeURIComponent(accountId)}`,accountSchema);
    if(account.customer_id!==customerId || account.type!=='Checking')throw new Error('Checking account ownership did not match.');
    await db.query('UPDATE user_integrations SET nessie_customer_id=$1,nessie_checking_account_id=$2,updated_at=now() WHERE user_id=$3',[customerId,accountId,user.id]);
    console.info('Nessie checking account linked to the selected app user.');
  }
  const memoryIndex=args.indexOf('--backboard-assistant-id');
  if(memoryIndex>=0){
    const id=z.string().min(1).max(200).parse(args[memoryIndex+1]);
    await db.query('UPDATE user_integrations SET backboard_assistant_id=$1,updated_at=now() WHERE user_id=$2',[id,user.id]);
    console.info('Dedicated Backboard assistant linked to the selected app user.');
  }
  if(!args.includes('--nessie-demo')&&memoryIndex<0)throw new Error('Choose --nessie-demo or --backboard-assistant-id.');
}
main().catch(()=>{console.error('Could not link integrations. Verify the app email, configured customer/account, and that each integration belongs to only one app user.');process.exitCode=1;}).finally(closeAuthDatabase);
