import type { AnalysisResult, FinancialState, Purchase, GoalImpact } from './finance';

export type ServiceMode = 'live' | 'demo' | 'fallback' | 'manual';
export interface ServiceStatus { name: string; mode: ServiceMode; detail: string }
export interface SafeDateChange {
  previousSafeDate: string | null;
  newSafeDate: string | null;
  differenceDays: number | null;
  causes: { label: string; amountCents: number }[];
}
export interface PurchaseAnalysis {
  dataSource: 'demo' | 'nessie';
  currentBalanceCents: number;
  purchasePriceCents: number;
  immediateBalanceAfterPurchaseCents: number;
  projectedMinimumBalanceCents: number;
  safetyBufferCents: number;
  bufferDifferenceCents: number;
  verdict: 'safe' | 'wait' | 'not_safe';
  safeDate: string | null;
  waitDays: number | null;
  reasons: string[];
  goalImpacts: GoalImpact[];
}
export interface DashboardData extends PurchaseAnalysis {
  accountChoices?: FinancialState['accounts'];
  planningProfile?: FinancialState;
  refreshedAt?: string;
  developmentExpenseEnabled?: boolean;
  dataSource: 'demo' | 'nessie';
  spendingFeatures?: {
    rolling7Cents: number; rolling30Cents: number; averageDailyCents: number;
    volatilityCents: number;
    weekdays: {weekday:number;averageCents:number;sampleDays:number}[];
  };
  snapshotId?: string;
  analysis: AnalysisResult;
  profile: FinancialState;
  purchase: Purchase;
  services: ServiceStatus[];
  preferences: string[];
  change: SafeDateChange | null;
  explanation: string;
}
