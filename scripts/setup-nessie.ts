import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { createNessieClient } from '../src/lib/nessie/client';
import { accountSchema, customerSchema, createdSchema, purchaseSchema, movementSchema } from '../src/lib/nessie/types';
import { IntegrationError } from '../src/lib/integrations/http';

// Explicit setup only: never imported by the application or called on startup.
async function main() {
  const client = createNessieClient({baseUrl:'https://api.nessieisreal.com'});
  const customers = await client.nessieGet('/customers', z.array(customerSchema));
  const matches = customers.filter(c => c.first_name === 'CanIBuyIt' && c.last_name === 'Demo User');
  if (matches.length > 1) throw new Error('Multiple demo customers; configure NESSIE_CUSTOMER_ID explicitly.');
  let customerId = process.env.NESSIE_CUSTOMER_ID?.trim() || matches[0]?._id;
  if (!customerId) {
    const result = await client.nessiePost('/customers', {first_name:'CanIBuyIt',last_name:'Demo User',address:{street_number:'6100',street_name:'Main Street',city:'Houston',state:'TX',zip:'77005'}}, createdSchema);
    customerId = result.objectCreated._id;
    console.info({created:'demo customer',id:customerId});
  }
  const customer = await client.nessieGet(`/customers/${encodeURIComponent(customerId)}`, customerSchema);
  if (customer.first_name !== 'CanIBuyIt' || customer.last_name !== 'Demo User') throw new Error('Setup only modifies the named demo customer.');
  const accounts = await client.nessieGet(`/customers/${customerId}/accounts`, z.array(accountSchema));
  let accountId = accounts.find(a => a.type === 'Checking' && a.nickname === 'CanIBuyIt Everyday Checking')?._id;
  if (!accountId) {
    const result = await client.nessiePost(`/customers/${customerId}/accounts`, {type:'Checking',nickname:'CanIBuyIt Everyday Checking',rewards:0,balance:1850}, createdSchema);
    accountId = result.objectCreated._id;
    console.info({created:'demo checking',id:accountId});
  }
  let env = readFileSync('.env.local','utf8');
  for (const [name,value] of Object.entries({NESSIE_CUSTOMER_ID:customerId,NESSIE_ACCOUNT_ID:accountId,NESSIE_BASE_URL:'https://api.nessieisreal.com',DEMO_MODE:'false',FINANCIAL_DATA_MODE:'auto'})) {
    const pattern = new RegExp(`^${name}=.*$`,'m');
    env = pattern.test(env) ? env.replace(pattern,`${name}=${value}`) : `${env.trimEnd()}\n${name}=${value}\n`;
  }
  writeFileSync('.env.local',env,{mode:0o600});
  const account = await client.nessieGet(`/accounts/${accountId}`, accountSchema);
  const [purchases,deposits,withdrawals] = await Promise.all([
    client.nessieGet(`/accounts/${accountId}/purchases`,z.array(purchaseSchema)),
    client.nessieGet(`/accounts/${accountId}/deposits`,z.array(movementSchema)),
    client.nessieGet(`/accounts/${accountId}/withdrawals`,z.array(movementSchema)),
  ]);
  console.info({customerId,accountId,balance:account.balance,counts:{purchases:purchases.length,deposits:deposits.length,withdrawals:withdrawals.length},configurationSaved:true});
}
main().catch(error => {
  console.error({status:'setup-failed',code:error instanceof IntegrationError ? error.code : 'validation',httpStatus:error instanceof IntegrationError ? error.status : undefined});
  process.exitCode=1;
});
