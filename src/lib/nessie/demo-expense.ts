import { createHash } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createNessieClient, type NessieClientOptions } from './client';
import { accountSchema, createdSchema, movementSchema } from './types';
import { NessieError } from './errors';
import { addDays } from '../finance/dates';
import { toCents } from './mapper';
import { insertFinancialEvent, type FinancialEvent } from '../integrations/tiger-analytics';

/** One explicit pending sandbox expense per account/day. Never retries an uncertain POST. */
export async function createDemoExpense(options:NessieClientOptions & {
  env?:Record<string,string|undefined>; journalDirectory?:string; applicationUserId?:string;
  sync?:(event:FinancialEvent)=>ReturnType<typeof insertFinancialEvent>;
} = {}) {
  const env=options.env??process.env;
  if(env.NODE_ENV==='production' || env.NESSIE_DEMO_EXPENSE_ENABLED!=='true' || env.DEMO_MODE==='true' || !env.NESSIE_ACCOUNT_ID || !env.NESSIE_CUSTOMER_ID)
    throw new Error('The Nessie expense demo is not enabled.');
  const client=createNessieClient({...options,apiKey:options.apiKey??env.NESSIE_API_KEY,baseUrl:options.baseUrl??env.NESSIE_BASE_URL});
  const id=encodeURIComponent(env.NESSIE_ACCOUNT_ID);
  const account=await client.nessieGet(`/accounts/${id}`,accountSchema);
  if(account.customer_id!==env.NESSIE_CUSTOMER_ID || account.type!=='Checking' || !account.nickname?.startsWith('CanIBuyIt'))
    throw new Error('The expense action requires the configured CanIBuyIt demo checking account.');
  const today=new Date().toISOString().slice(0,10);
  const description=`canibuyit-demo-expense:${today}:Auto Repair`;
  const list=()=>client.nessieGet(`/accounts/${id}/withdrawals`,z.array(movementSchema));
  let expense=(await list()).find(item=>item.description===description);
  if(!expense) {
    const directory=options.journalDirectory??'.local/nessie-expenses';
    await mkdir(directory,{recursive:true});
    const file=join(directory,createHash('sha256').update(`${account._id}:${description}`).digest('hex')+'.json');
    try {
      const journal=await open(file,'wx',0o600);
      await journal.writeFile(JSON.stringify({accountId:account._id,description,state:'attempted'}));
      await journal.close();
    } catch {throw new Error('This expense may already be processing. Refresh finances before trying again.');}
    let expenseId:string;
    try {
      const created=await client.nessiePost(`/accounts/${id}/withdrawals`,{medium:'balance',transaction_date:addDays(today,1),status:'pending',amount:430,description},createdSchema);
      expenseId=created.objectCreated._id;
    } catch(error) {
      // A documented rejection means nothing was created. Timeouts/5xx remain locked.
      if(error instanceof NessieError && error.status && error.status>=400 && error.status<500) await unlink(file);
      throw error;
    }
    // The account list works on the current sandbox; individual withdrawal GET returned 403.
    expense=(await list()).find(item=>item._id===expenseId && item.description===description);
    if(!expense) throw new Error('The expense is processing. Refresh finances before trying again.');
  }
  if(expense.description!==description || expense.payer_id && expense.payer_id!==account._id || expense.status==='cancelled')
    throw new Error('The demo expense could not be verified.');
  const event:FinancialEvent={eventId:`nessie-withdrawal-${expense._id}`,userId:options.applicationUserId??account.customer_id,accountId:account._id,
    time:`${expense.transaction_date}T00:00:00.000Z`,amountCents:-toCents(expense.amount),category:'transportation',merchant:'Auto Repair',
    eventType:'unexpected_expense',metadata:{source:'nessie',status:expense.status,scenario:true}};
  const sync=await (options.sync??(event=>insertFinancialEvent(event,{userId:event.userId})))(event);
  return {expenseId:expense._id,amountCents:toCents(expense.amount),date:expense.transaction_date,status:expense.status,
    tigerSynced:sync.mode==='live',message:expense.status==='pending'
      ? `Nessie recorded the repair as pending for ${expense.transaction_date}. Your current balance stays unchanged until it posts; the forecast includes the scheduled expense.`
      : 'Nessie recorded the repair. The refreshed forecast uses the returned banking balance.'};
}
