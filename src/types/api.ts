import type { AnalysisResult, FinancialState, Purchase } from './finance';

export type ServiceMode = 'live' | 'demo' | 'fallback' | 'manual';
export interface ServiceStatus { name: string; mode: ServiceMode; detail: string }
export interface SafeDateChange {
  previousSafeDate: string | null;
  newSafeDate: string | null;
  differenceDays: number | null;
  causes: { label: string; amountCents: number }[];
}
export interface DashboardData {
  snapshotId?: string;
  analysis: AnalysisResult;
  profile: FinancialState;
  purchase: Purchase;
  services: ServiceStatus[];
  preferences: string[];
  change: SafeDateChange | null;
  explanation: string;
}
