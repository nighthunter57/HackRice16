import { authDatabase } from './auth/database';
import { preferenceSchema } from '../integrations/backboard';
import { z } from 'zod';
import { demoPurchase, injectRepair } from '@/data/demo-profile';
import { bankingDemoProfile } from '@/data/banking-demo';
import { createFinancialProvider, DemoFinancialDataProvider } from '@/lib/financial-providers';
import { analyze, addDays } from '@/lib/finance';
import { getPreferences, insertFinancialEvents, readDailySpending, saveSnapshot, saveDecision, insertFinancialEvent } from '@/lib/integrations';
import type { DashboardData, ServiceStatus } from '@/types/api';
import type { Transaction } from '@/types/finance';
import { money, shortDate } from '@/lib/display';
import { forecastChange } from '@/lib/finance/changes';
import { getUnexpectedExpenses, getCategoryForecastHistory, readSnapshotById, getForecastInputs, getDayOfWeekAverages, getSpendingVolatility } from '@/lib/integrations/tiger-analytics';
import type { TigerOptions } from '@/lib/integrations/tiger';
import { purchaseSchema } from '@/types/purchase';
import { IntegrationError } from '@/lib/integrations/http';
import { purchaseAnalysis } from '@/lib/finance/purchase-analysis';
import { financialSettingsSchema, financialSettingsListSchema } from '@/types/financial-settings';
import { integrationsFor, providerEnvironment } from './auth/integrations';
import { ownedState } from '../finance/ownership';
import { AuthError } from './auth/errors';
import { applyFinancialSettings } from '@/lib/finance/settings';

export const analysisInputSchema = z.object({
  settings: financialSettingsSchema.optional(),
  settingsProfiles: financialSettingsListSchema.optional(),
  previousSnapshotId: z.string().uuid().optional(),
  purchase: purchaseSchema,
  horizonDays: z.number().int().min(30).max(90).default(60),
  safetyBufferCents: z.number().int().min(0).max(9_999_999_999).default(40_000),
  repair: z.boolean().default(false),
  mode: z.enum(['demo','live']).default('demo'),
}).strict();
export type AnalysisInput = z.infer<typeof analysisInputSchema>;

export function initialDashboard(): DashboardData {
  const profile = bankingDemoProfile();
  const analysis = analyze(profile, demoPurchase);
  return {...purchaseAnalysis('demo', analysis), profile, analysis, purchase: demoPurchase, services: [
    {name:'Nessie',mode:'demo',detail:'A deterministic seeded financial profile.'},
    {name:'Tiger Data',mode:'demo',detail:'60 days of seeded transaction history.'},
    {name:'Gemini',mode:'manual',detail:'Manual entry works without an AI service.'},
    {name:'Backboard',mode:'demo',detail:'Local demo preferences.'},
  ], preferences:['Your Japan trip comes first. You prefer waiting for electronics over delaying travel.'], change:null, explanation:explain(analysis, profile.safetyBufferCents) };
}

function explain(analysis: DashboardData['analysis'], buffer: number): string {
  if (analysis.today.verdict === 'SAFE') return 'Based on your forecast, this purchase keeps your bills covered and your configured safety reserve intact.';
  const deficit = Math.max(0, buffer - analysis.today.minimumBalanceCents);
  const problem = deficit ? `Buying today leaves your projected cash ${money(deficit,true)} below your safety reserve.` : 'Buying today exceeds a configured goal constraint.';
  return `${problem} ${analysis.safeDate ? `Waiting until ${shortDate(analysis.safeDate)} satisfies the forecast constraints.` : 'No safe purchase date was found inside this forecast.'}`;
}

export async function buildDashboard(input: AnalysisInput, remoteAllowed: boolean, databaseOptions:TigerOptions={},authenticatedUserId?:string): Promise<DashboardData> {
  const integrations=authenticatedUserId?await integrationsFor(authenticatedUserId):undefined;
  if(authenticatedUserId && [input.settings,...(input.settingsProfiles??[])].some(settings=>settings && settings.userId!==authenticatedUserId)) throw new AuthError(403,'Financial settings belong to a different account.');
  const options = {horizonDays:input.horizonDays,safetyBufferCents:input.safetyBufferCents};
  // Provider choice stays here; both providers follow the identical Tiger path.
  let loaded;
  try {
    const provider = remoteAllowed ? createFinancialProvider(options,integrations?providerEnvironment(integrations):process.env) : new DemoFinancialDataProvider(options);
    loaded = await provider.loadFinancialState();
  }
  catch (error) {
    const code = error instanceof IntegrationError ? error.code : 'invalid-response';
    console.info('[financial.provider]', {source:'nessie',status:'fallback',code});
    loaded = await new DemoFinancialDataProvider(options).loadFinancialState();
    loaded.warnings.push("Financial data couldn't refresh. Using demo data.");
  }
  if(authenticatedUserId) {loaded.state=ownedState(loaded.state,authenticatedUserId);loaded.historyTransactions=loaded.historyTransactions.map(tx=>({...tx,userId:authenticatedUserId}));}
  const source = loaded.source;
  const accountChoices = loaded.state.accounts;
  let profile = loaded.state;
  const history = loaded.historyTransactions;
  const services: ServiceStatus[] = [{name:'Nessie',mode:source==='nessie'?'live':loaded.warnings.includes("Financial data couldn't refresh. Using demo data.")?'fallback':'demo',
    detail:source==='demo'?'DemoFinancialDataProvider active. No live Nessie data. '+loaded.warnings.join(' '):loaded.warnings.join(' ')}];
  const tigerOptions = {...databaseOptions,userId: profile.userId};
  let previous = null;
  let snapshotId: string | undefined;
  let spendingFeatures: DashboardData['spendingFeatures'];
  let tigerMode: ServiceStatus['mode'] = 'demo';
  let tigerDetail = 'Using already-loaded transaction history.';
  if (remoteAllowed && (!authenticatedUserId || source==='nessie') && (databaseOptions.db || process.env.TIGER_DATABASE_URL || process.env.DATABASE_URL)) {
    const written = await insertFinancialEvents(history, tigerOptions);
    if (written.mode === 'live') {
      const aggregate = await readDailySpending(addDays(profile.startDate,-30),addDays(profile.startDate,-1),tigerOptions);
      if (aggregate.mode === 'live') {
        const accountId = profile.accounts[0].id;
        const aggregated: Transaction[] = aggregate.data.map(day=>({id:`aggregate:${day.date}`,userId:profile.userId,accountId,timestamp:`${day.date}T12:00:00.000Z`,amountCents:-day.spendingCents,category:'daily-spending',merchant:'Tiger Data daily aggregate',eventType:'discretionary'}));
        profile = {...profile,transactions:[...aggregated,...profile.transactions.filter(tx=>tx.timestamp.slice(0,10)>=profile.startDate)]};
        tigerMode='live'; tigerDetail='Timescale daily_spending continuous aggregate feeds the deterministic spending forecast.';
        const categories=await getCategoryForecastHistory(profile.userId,profile.startDate,tigerOptions);
        if(categories.mode==='live') profile={...profile,transactions:[
          ...categories.data.map((day,i):Transaction=>({id:`category:${day.day}:${i}`,userId:profile.userId,accountId,timestamp:`${day.day}T12:00:00.000Z`,amountCents:-day.spent_cents,category:day.category??'other',merchant:'Tiger category aggregate',eventType:'discretionary'})),
          ...profile.transactions.filter(tx=>tx.timestamp.slice(0,10)>=profile.startDate)]};
      } else { tigerMode='fallback'; tigerDetail=aggregate.reason; }
    } else { tigerMode='fallback'; tigerDetail=written.reason; }
  }
  const withoutChanges=structuredClone(profile);
  if(tigerMode==='live') {
    const [rolling,weekdays,volatility] = await Promise.all([
      getForecastInputs(profile.userId,profile.startDate,tigerOptions),
      getDayOfWeekAverages(profile.userId,profile.startDate,tigerOptions),
      getSpendingVolatility(profile.userId,profile.startDate,tigerOptions),
    ]);
    if(rolling.mode==='live' && weekdays.mode==='live' && volatility.mode==='live')
      spendingFeatures={...rolling.data,weekdays:weekdays.data,volatilityCents:volatility.data};
    if(input.previousSnapshotId) {
      const prior=await readSnapshotById(input.previousSnapshotId,tigerOptions);
      if(prior.mode==='live') previous=prior.data;
    }
    if(input.repair && source==='demo' && (process.env.NODE_ENV!=='production' || process.env.DEMO_MODE==='true')) {
      const written=await insertFinancialEvent({eventId:'demo-repair',userId:profile.userId,accountId:profile.accounts[0].id,time:`${addDays(profile.startDate,8)}T00:00:00.000Z`,amountCents:-43000,category:'transportation',merchant:'Auto Repair',eventType:'unexpected_expense',metadata:{source:'canibuyit-demo',scenario:true}},tigerOptions);
      if(written.mode!=='live') {tigerMode='fallback';tigerDetail=written.reason;}
    }
    // The current demo's opening balance is fixed at startDate. Expenses from
    // that day onward must be scheduled once, not also debited from the balance.
    if(source==='demo' && tigerMode==='live') {
      const events=await getUnexpectedExpenses(profile.userId,profile.horizonDays,addDays(profile.startDate,profile.horizonDays),tigerOptions);
      if(events.mode==='live') {
        for(const event of events.data) {
          if(event.eventId==='demo-repair' && !input.repair) continue;
          const id=`tiger:${event.eventId}:${event.time}`;
          if(!profile.bills.some(b=>b.id===id)) profile.bills.push({id,userId:profile.userId,name:event.merchant??'Unexpected expense',amountCents:-event.amountCents,dueDate:event.time.slice(0,10),recurrence:'once',mandatory:true});
        }
      } else {tigerMode='fallback';tigerDetail=events.reason;}
    }
  }
  if(tigerMode!=='live' && input.repair && source==='demo' && (process.env.NODE_ENV!=='production' || process.env.DEMO_MODE==='true')) profile=injectRepair(profile);
  const planningProfile=profile;
  const selectedSettings=input.settingsProfiles?.find(s=>s.userId===profile.userId && s.dataSource===source)??input.settings;
  profile=applyFinancialSettings(profile,source,selectedSettings);
  const analysis=analyze(profile,input.purchase);
  const change=forecastChange(previous??withoutChanges,profile,input.purchase);
  if (tigerMode==='live') {
    const saved = await saveSnapshot(profile,source,tigerOptions);
    if(saved.mode==='live') snapshotId=saved.data.id;
    await saveDecision({productName:input.purchase.productName,priceCents:input.purchase.priceCents,verdict:analysis.today.verdict,safeDate:analysis.safeDate,action:'consider',source},tigerOptions);
    if (saved.mode!=='live') { tigerMode='fallback'; tigerDetail='Analytics loaded; forecast snapshot could not be saved.'; }
  }
  services.push({name:'Tiger Data',mode:tigerMode,detail:tigerDetail});
  services.push({name:'Gemini',mode:'manual',detail:process.env.GEMINI_API_KEY?'Product scanning is configured; this forecast used confirmed product input.':'Product scanning is not configured; manual entry remains available.'});
  const memory = remoteAllowed ? await getPreferences(integrations?{assistantId:integrations.backboard_assistant_id??''}:{}) : {preferences:[],mode:'unavailable',warnings:[]};
  const localPreferences=authenticatedUserId?(await authDatabase().query('SELECT key,value FROM user_preferences WHERE user_id=$1',[authenticatedUserId])).rows.map(row=>preferenceSchema.parse(row)):[];
  const remembered=new Map(memory.preferences.map(p=>[p.key,p]));
  for(const preference of localPreferences)remembered.set(preference.key,preference);
  const preferences = [...remembered.values()].map(preference => {
    if (preference.key==='spendingPriority') return preference.value==='experiences'?'You prioritize experiences. Consider waiting for electronics to preserve your travel plans.':preference.value==='saving'?'You prioritize saving. Compare the goal dates before deciding.':'You prioritize essentials. Keep upcoming obligations in view.';
    if (preference.key==='riskTolerance') return `Your remembered planning preference is ${preference.value}. Your configured financial constraints still determine every result.`;
    return `You prefer ${preference.value} explanations.`;
  });
  if (!preferences.length) preferences.push(input.mode==='demo'?'Your Japan trip comes first. You prefer waiting for electronics over delaying travel.':'Your configured reserve and financial goals guide this projection.');
  services.push({name:'Backboard',mode:memory.mode==='live'?'live':'fallback',detail:memory.mode==='live'?'Persistent semantic preferences retrieved. Financial outcomes remain deterministic.':'Local/default preferences; no remote memory was used.'});
  return {...purchaseAnalysis(source,analysis),profile,planningProfile,accountChoices,refreshedAt:new Date().toISOString(),
    developmentExpenseEnabled:source==='nessie' && process.env.NODE_ENV!=='production' && process.env.NESSIE_DEMO_EXPENSE_ENABLED==='true' && (!integrations || !!integrations.nessie_checking_account_id),
    analysis,purchase:input.purchase,services,preferences,change,snapshotId,spendingFeatures,explanation:explain(analysis,profile.safetyBufferCents)};
}
