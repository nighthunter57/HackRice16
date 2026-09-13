/** All money is integer USD cents; all dates are real UTC YYYY-MM-DD dates. */
export type Recurrence = 'once' | 'weekly' | 'biweekly' | 'monthly';

export interface Account {
  id: string;
  userId: string;
  name: string;
  type: 'checking' | 'savings';
  balanceCents: number;
}

export interface Transaction {
  id: string;
  userId: string;
  accountId: string;
  timestamp: string;
  amountCents: number;
  category: string;
  merchant: string;
  /** Only historical discretionary expenses inform expected spending. */
  eventType: 'discretionary' | 'income' | 'bill' | 'transfer';
}

export interface Bill {
  id: string;
  userId: string;
  name: string;
  amountCents: number;
  dueDate: string;
  recurrence: Recurrence;
  /** Bills are mandatory unless explicitly marked otherwise. */
  mandatory?: boolean;
}

export interface IncomeEvent {
  accountId?: string;
  id: string;
  userId: string;
  name?: string;
  amountCents: number;
  expectedDate: string;
  recurrence?: Recurrence;
}

export interface SavingsGoal {
  id: string;
  userId: string;
  name: string;
  targetCents: number;
  /** Already earmarked within account balances, not additional assets. */
  savedCents: number;
  deadline?: string;
  /** Maximum permitted delay relative to baseline; defaults to zero. */
  maxDelayDays?: number;
}

export type Goal = SavingsGoal;

export interface FinancialState {
  userId: string;
  startDate: string;
  horizonDays: number;
  accounts: Account[];
  transactions: Transaction[];
  bills: Bill[];
  incomeEvents: IncomeEvent[];
  /** Array order determines priority for allocating shared surplus. */
  goals: Goal[];
  safetyBufferCents: number;
}

export interface Purchase {
  productName: string;
  priceCents: number;
  category: string;
  purchaseType: 'essential' | 'discretionary' | 'unknown';
}

export interface ForecastEvent {
  id: string;
  name: string;
  type: 'income' | 'bill' | 'transaction' | 'expected-spending' | 'purchase';
  /** Signed cash-flow amount. Events appear in execution order. */
  amountCents: number;
  mandatory: boolean;
}

export interface ForecastDay {
  date: string;
  openingBalanceCents: number;
  incomeCents: number;
  billsCents: number;
  expectedSpendingCents: number;
  purchasesCents: number;
  transactionNetCents: number;
  closingBalanceCents: number;
  minimumBalanceCents: number;
  safetyBufferCents: number;
  availableCents: number;
  billsCovered: boolean;
  safetyBufferViolation: boolean;
  events: ForecastEvent[];
}

export interface GoalImpact {
  goalId: string;
  name: string;
  baselineDate: string | null;
  projectedDate: string | null;
  delayDays: number | null;
}

export interface BalanceImpact {
  currentBalanceCents: number;
  purchasePriceCents: number;
  /** Opening spendable cash for today; projected cash before a future purchase. */
  balanceBeforePurchaseCents: number;
  immediateBalanceAfterPurchaseCents: number;
  projectedMinimumBalanceCents: number;
  safetyBufferCents: number;
  /** Forecast minimum minus safety buffer; negative means a shortfall. */
  bufferDifferenceCents: number;
  purchaseDate: string | null;
  isFuturePurchase: boolean;
}

export interface SimulationResult {
  balanceImpact: BalanceImpact;
  days: ForecastDay[];
  minimumBalanceCents: number;
  minimumBalanceDate: string;
  finalBalanceCents: number;
  billsCovered: boolean;
  safetyBufferViolation: boolean;
  verdict: 'SAFE' | 'CAUTION' | 'NOT_RECOMMENDED';
  goalImpacts: GoalImpact[];
  proposedPurchaseDate: string | null;
}

export interface AnalysisResult {
  baseline: SimulationResult;
  today: SimulationResult;
  wait: SimulationResult | null;
  safeDate: string | null;
  safeMaximumCents: number | null;
  waitDays: number | null;
  reasons: string[];
}
