import { z } from 'zod';
import { authDatabase } from './database';
export const integrationSchema=z.object({nessie_customer_id:z.string().nullable(),nessie_checking_account_id:z.string().nullable(),backboard_assistant_id:z.string().nullable()});
export type UserIntegrations=z.infer<typeof integrationSchema>;
export async function integrationsFor(userId:string):Promise<UserIntegrations> {
  const row=(await authDatabase().query('SELECT nessie_customer_id,nessie_checking_account_id,backboard_assistant_id FROM user_integrations WHERE user_id=$1',[userId])).rows[0];
  return row?integrationSchema.parse(row):{nessie_customer_id:null,nessie_checking_account_id:null,backboard_assistant_id:null};
}
export function providerEnvironment(integrations:UserIntegrations) {
  return {...process.env,NESSIE_CUSTOMER_ID:integrations.nessie_customer_id??'',NESSIE_ACCOUNT_ID:integrations.nessie_checking_account_id??'',
    NESSIE_API_KEY:integrations.nessie_customer_id?process.env.NESSIE_API_KEY:undefined,
    // The legacy schedule belongs only to the explicitly mapped legacy customer.
    NESSIE_SCHEDULE_PATH:integrations.nessie_customer_id===process.env.NESSIE_CUSTOMER_ID?process.env.NESSIE_SCHEDULE_PATH:undefined,
    NESSIE_SCHEDULE_JSON:integrations.nessie_customer_id===process.env.NESSIE_CUSTOMER_ID?process.env.NESSIE_SCHEDULE_JSON:undefined};
}
