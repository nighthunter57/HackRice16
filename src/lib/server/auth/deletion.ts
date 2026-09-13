import { z } from 'zod';
import { authDatabase,transaction } from './database';
import { integrationsFor } from './integrations';
import { deleteApplicationMemories } from '../../integrations/backboard';
import { AuthError } from './errors';
export async function deleteAccount(userId:string) {
  const integrations=await integrationsFor(userId);
  if(integrations.backboard_assistant_id) {
    const removed=await deleteApplicationMemories({assistantId:integrations.backboard_assistant_id});
    if(!removed)throw new AuthError(503,'Account deletion could not finish. Please try again when memory storage is available.');
  }
  const dates=await transaction(async db=>{
    if(!(await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId])).rowCount)return null;
    await db.query(`INSERT INTO account_deletion_requests(user_id,history_start,history_finish)
      SELECT $1::uuid,min(time),max(time) FROM financial_events WHERE user_id=$1::text
      ON CONFLICT(user_id) DO NOTHING`,[userId]);
    const bounds=(await db.query('SELECT history_start AS start,history_finish AS finish FROM account_deletion_requests WHERE user_id=$1',[userId])).rows[0];
    await db.query('DELETE FROM financial_events WHERE user_id=$1',[userId]);
    await db.query('DELETE FROM financial_snapshots WHERE user_id=$1',[userId]);
    await db.query('DELETE FROM purchase_decisions WHERE user_id=$1',[userId]);
    return z.object({start:z.coerce.date().nullable(),finish:z.coerce.date().nullable()}).parse(bounds);
  });
  if(!dates)return;
  // Timescale requires CALL outside a transaction. Keep the account and durable
  // cleanup bounds until both aggregates refresh, so an outage is retryable.
  if(dates.start && dates.finish)for(const aggregate of ['daily_spending','daily_cash_flow']) {
    await authDatabase().query(`CALL refresh_continuous_aggregate('${aggregate}',$1::timestamptz,$2::timestamptz)`,[new Date(dates.start.valueOf()-86400000),new Date(dates.finish.valueOf()+86400000)]);
  }
  await authDatabase().query('DELETE FROM users WHERE id=$1',[userId]);
}
