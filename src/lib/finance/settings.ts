import type { FinancialState } from '../../types/finance';
import { financialSettingsSchema, type FinancialSettings } from '../../types/financial-settings';
import { validateState } from './validation';

export function settingsFor(state: FinancialState, dataSource: 'demo'|'nessie'): FinancialSettings {
  return {userId:state.userId,dataSource,accountIds:state.accounts.map(a=>a.id),safetyBufferCents:state.safetyBufferCents,
    bills:[],excludedBillIds:[],incomeEvents:[],excludedIncomeIds:[],goals:structuredClone(state.goals)};
}

function merge<T extends {id:string}>(original:T[], edits:T[], excluded:string[]):T[] {
  const entries = new Map(original.map(item=>[item.id,item]));
  for (const item of edits) entries.set(item.id,item);
  return [...entries.values()].filter(item=>!excluded.includes(item.id));
}

export function applyFinancialSettings(state: FinancialState, source:'demo'|'nessie', input?:FinancialSettings):FinancialState {
  if (!input) return state;
  const settings = financialSettingsSchema.parse(input);
  // A bank outage must not apply that customer's settings to the demo user.
  if (settings.userId !== state.userId || settings.dataSource !== source) return state;
  if (settings.accountIds.some(id=>!state.accounts.some(a=>a.id===id))) throw new Error('A selected account is no longer available. Update Financial setup.');
  const accounts = state.accounts.filter(a=>settings.accountIds.includes(a.id));
  const next = {...state,accounts,safetyBufferCents:settings.safetyBufferCents,
    transactions:state.transactions.filter(t=>settings.accountIds.includes(t.accountId) || t.id.startsWith('aggregate:') || t.id.startsWith('category:')).map(t=>{
      if(t.id.startsWith('aggregate:') || t.id.startsWith('category:')) return {...t,accountId:accounts[0].id};
      if(t.eventType!=='transfer') return t;
      const baseId=t.id.replace(/-credit$/,'');
      const other=state.transactions.find(other=>other.id!==t.id && other.id.replace(/-credit$/,'')===baseId);
      return other && !settings.accountIds.includes(other.accountId) ? {...t,eventType:t.amountCents<0?'bill' as const:'income' as const} : t;
    }),
    bills:merge(state.bills,settings.bills,settings.excludedBillIds),
    incomeEvents:merge(state.incomeEvents,settings.incomeEvents,settings.excludedIncomeIds).filter(i=>!i.accountId || settings.accountIds.includes(i.accountId)),goals:settings.goals};
  validateState(next);
  return next;
}
