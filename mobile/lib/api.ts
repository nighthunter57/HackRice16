import { z } from 'zod';
import { analyze } from '../../src/lib/finance';
import { financialStateSchema } from '../../src/types/financial-state-schema';
import type { DashboardData } from '../../src/types/api';
import type { Purchase } from '../../src/types/finance';
import { purchaseSchema, demoAnalysis } from './model';
import type { FinancialSettings } from '../../src/types/financial-settings';
import { ownedState } from '../../src/lib/finance/ownership';
import { applyFinancialSettings } from '../../src/lib/finance/settings';
import { purchaseAnalysis } from '../../src/lib/finance/purchase-analysis';

const resultSchema=z.object({
  accountChoices:financialStateSchema.shape.accounts.optional(),
  planningProfile:financialStateSchema.optional(),
  refreshedAt:z.string().datetime().optional(),developmentExpenseEnabled:z.boolean().optional(),
  dataSource:z.enum(['demo','nessie']),
  profile:financialStateSchema,purchase:purchaseSchema,snapshotId:z.string().uuid().optional(),
  services:z.array(z.object({name:z.string(),mode:z.enum(['live','demo','fallback','manual']),detail:z.string()})),
  preferences:z.array(z.string()),explanation:z.string(),
  change:z.object({previousSafeDate:z.string().nullable(),newSafeDate:z.string().nullable(),differenceDays:z.number().int().nullable(),causes:z.array(z.object({label:z.string(),amountCents:z.number().int().safe()}))}).nullable(),
});
export function parseDashboard(value:unknown,purchase:Purchase):DashboardData {
  const parsed=resultSchema.parse(value);
  if(parsed.planningProfile && parsed.planningProfile.userId!==parsed.profile.userId || parsed.accountChoices?.some(a=>a.userId!==parsed.profile.userId)) throw new Error('Financial profile mismatch');
  if(parsed.purchase.productName!==purchase.productName || parsed.purchase.priceCents!==purchase.priceCents ||
    parsed.purchase.category!==purchase.category || parsed.purchase.purchaseType!==purchase.purchaseType) throw new Error('Purchase mismatch');
  // Recompute from validated server state with the same shared engine. No
  // unchecked network balances/verdicts are rendered as simulation results.
  const analysis = analyze(parsed.profile,parsed.purchase);
  return {...parsed,...purchaseAnalysis(parsed.dataSource,analysis),analysis};
}
export async function requestAnalysis(purchase:Purchase,repair:boolean,url:string,token:string,previousSnapshotId?:string,fetcher:typeof fetch=fetch,settings?:FinancialSettings,settingsProfiles?:FinancialSettings[]):Promise<DashboardData> {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),25000);
  try {
    const response=await fetcher(`${url.replace(/\/$/,'')}/api/analyze`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
      body:JSON.stringify({purchase,repair,mode:'demo',horizonDays:60,safetyBufferCents:settings?.safetyBufferCents??40000,previousSnapshotId,settings,settingsProfiles}),signal:controller.signal});
    if(!response.ok) throw new Error(response.status===401?'Please sign in again.':'Analysis is unavailable.');
    return parseDashboard(await response.json(),purchase);
  } finally {clearTimeout(timeout);}
}
export function offlineDashboard(purchase:Purchase,repair:boolean,settings?:FinancialSettings,userId?:string):DashboardData {
  const demo = demoAnalysis(purchase,repair);
  if(userId)demo.profile=ownedState(demo.profile,userId);
  const accountChoices = demo.profile.accounts;
  const planningProfile = demo.profile;
  demo.profile = applyFinancialSettings(demo.profile,'demo',settings);
  demo.analysis = analyze(demo.profile,purchase);
  return {...demo,accountChoices,planningProfile,...purchaseAnalysis('demo',demo.analysis),services:[{name:'Nessie',mode:'demo',detail:'DemoFinancialDataProvider profile. No live Nessie data.'},{name:'Tiger Data',mode:'fallback',detail:'Backend unavailable. Using the local demo profile.'}],preferences:[],change:null,explanation:'Offline demo forecast. Live financial data was not loaded.'};
}

export async function requestDemoExpense(current:DashboardData,url:string,token:string,settings:FinancialSettings,fetcher:typeof fetch=fetch) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),60_000);
  try {
    const response=await fetcher(`${url.replace(/\/$/,'')}/api/demo-expense`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
      body:JSON.stringify({purchase:current.purchase,previousSnapshotId:current.snapshotId,settings,horizonDays:current.profile.horizonDays,safetyBufferCents:settings.safetyBufferCents}),signal:controller.signal});
    if(!response.ok) throw new Error('The expense could not be confirmed. Refresh finances before retrying; it may already be pending.');
    const result=z.object({expenseId:z.string(),amountCents:z.number().int().safe().nonnegative(),date:z.string(),status:z.enum(['pending','completed','executed']),tigerSynced:z.boolean(),message:z.string(),dashboard:z.unknown().optional()}).parse(await response.json());
    return {...result,dashboard:result.dashboard?parseDashboard(result.dashboard,current.purchase):undefined};
  } finally {clearTimeout(timeout);}
}
