import type { AnalysisResult, FinancialState, ForecastDay, ForecastEvent, GoalImpact, Purchase, SimulationResult } from '../../types/finance';
import { addDays, assertDate, dateFromTimestamp, daysBetween, occursOn } from './dates';
import { addCents, formatMoney } from './money';
import { validatePurchase, validateState } from './validation';

export { addDays, assertDate, dateFromTimestamp, daysBetween, occursOn } from './dates';
export { formatMoney, formatCents } from './money';
export type * from '../../types/finance';

function sum(values: number[]): number {
  return values.reduce((total, value) => addCents(total, value), 0);
}

function forecast(state: FinancialState, purchase?: Purchase, purchaseDate?: string): ForecastDay[] {
  const historicalSpending = sum(state.transactions.filter(transaction => {
    const date = dateFromTimestamp(transaction.timestamp);
    const age = daysBetween(date, state.startDate);
    return age >= 1 && age <= 30 && transaction.amountCents < 0 && transaction.eventType === 'discretionary';
  }).map(transaction => -transaction.amountCents));
  const dailySpending = Math.floor(historicalSpending / 30);
  const remainder = historicalSpending % 30;
  let balance = addCents(sum(state.accounts.map(account => account.balanceCents)), -sum(state.goals.map(goal => goal.savedCents)));
  const days: ForecastDay[] = [];
  for (let index = 0; index < state.horizonDays; index += 1) {
    const date = addDays(state.startDate, index);
    const events: ForecastEvent[] = [];
    const scheduled = state.transactions.filter(transaction => dateFromTimestamp(transaction.timestamp) === date && transaction.eventType !== 'transfer');
    for (const income of state.incomeEvents) {
      if (occursOn(income.expectedDate, income.recurrence ?? 'once', date)) {
        events.push({ id: income.id, name: income.name ?? 'Income', type: 'income', amountCents: income.amountCents, mandatory: false });
      }
    }
    // Credits clear first. Stable array order resolves ties within event classes.
    for (const transaction of scheduled.filter(item => item.amountCents >= 0)) {
      events.push({ id: transaction.id, name: transaction.merchant, type: 'transaction', amountCents: transaction.amountCents, mandatory: false });
    }
    for (const bill of state.bills) {
      if (occursOn(bill.dueDate, bill.recurrence, date)) {
        events.push({ id: bill.id, name: bill.name, type: 'bill', amountCents: -bill.amountCents, mandatory: bill.mandatory !== false });
      }
    }
    for (const transaction of scheduled.filter(item => item.amountCents < 0)) {
      events.push({ id: transaction.id, name: transaction.merchant, type: 'transaction', amountCents: transaction.amountCents, mandatory: transaction.eventType === 'bill' });
    }
    // Distribute remainder cents deterministically rather than lose fractions daily.
    // Known spending consumes the daily estimate without erasing its remainder.
    // A small pending purchase cannot make the rest of the day's food/gas vanish.
    const knownSpending = sum(scheduled.filter(item => item.eventType === 'discretionary' && item.amountCents < 0).map(item => -item.amountCents));
    const expectedSpending = Math.max(0, dailySpending + (index % 30 < remainder ? 1 : 0) - knownSpending);
    if (expectedSpending > 0) events.push({ id: `expected:${date}`, name: 'Expected everyday spending', type: 'expected-spending', amountCents: -expectedSpending, mandatory: false });
    if (purchase && date === purchaseDate) {
      events.push({ id: `purchase:${date}`, name: purchase.productName, type: 'purchase', amountCents: -purchase.priceCents, mandatory: false });
    }
    const openingBalanceCents = balance;
    let minimumBalanceCents = balance;
    let billsCovered = true;
    for (const event of events) {
      if (event.mandatory && balance < -event.amountCents) billsCovered = false;
      balance = addCents(balance, event.amountCents);
      minimumBalanceCents = Math.min(minimumBalanceCents, balance);
    }
    days.push({
      date, openingBalanceCents, closingBalanceCents: balance, minimumBalanceCents,
      incomeCents: sum(events.filter(event => event.type === 'income').map(event => event.amountCents)),
      billsCents: sum(events.filter(event => event.type === 'bill').map(event => -event.amountCents)),
      expectedSpendingCents: expectedSpending,
      purchasesCents: purchase && date === purchaseDate ? purchase.priceCents : 0,
      transactionNetCents: sum(events.filter(event => event.type === 'transaction').map(event => event.amountCents)),
      safetyBufferCents: state.safetyBufferCents,
      availableCents: Math.max(0, addCents(balance, -state.safetyBufferCents)),
      billsCovered,
      safetyBufferViolation: minimumBalanceCents < state.safetyBufferCents,
      events,
    });
  }
  return days;
}

/** Allocate durable surplus once in goal priority order; reserves are already excluded. */
function goalDates(state: FinancialState, days: ForecastDay[]): (string | null)[] {
  const durableSurplus = new Map<string, number>();
  let laterMinimum: number | undefined;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    if (!day) continue;
    const minimum = laterMinimum === undefined ? day.closingBalanceCents : Math.min(day.closingBalanceCents, laterMinimum);
    durableSurplus.set(day.date, Math.max(0, addCents(minimum, -state.safetyBufferCents)));
    laterMinimum = Math.min(minimum, day.minimumBalanceCents);
  }
  let precedingNeed = 0;
  return state.goals.map(goal => {
    const need = addCents(goal.targetCents, -goal.savedCents);
    precedingNeed = addCents(precedingNeed, need);
    if (need === 0) return state.startDate;
    return days.find(day => (durableSurplus.get(day.date) ?? 0) >= precedingNeed)?.date ?? null;
  });
}

function result(state: FinancialState, days: ForecastDay[], baselineDates: (string | null)[], proposedPurchaseDate: string | null): SimulationResult {
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  if (!firstDay || !lastDay) throw new RangeError('Forecast must contain at least one day.');
  let minimumBalanceCents = firstDay.minimumBalanceCents;
  let minimumBalanceDate = firstDay.date;
  for (const day of days) {
    if (day.minimumBalanceCents < minimumBalanceCents) {
      minimumBalanceCents = day.minimumBalanceCents;
      minimumBalanceDate = day.date;
    }
  }
  const dates = goalDates(state, days);
  const goalImpacts: GoalImpact[] = state.goals.map((goal, index) => {
    const baselineDate = baselineDates[index] ?? null;
    const projectedDate = dates[index] ?? null;
    return { goalId: goal.id, name: goal.name, baselineDate, projectedDate,
      delayDays: baselineDate !== null && projectedDate !== null ? Math.max(0, daysBetween(baselineDate, projectedDate)) : null };
  });
  const goalDeadlineViolation = state.goals.some((goal, index) => {
    const impact = goalImpacts[index];
    return Boolean(goal.deadline && (!impact?.projectedDate || impact.projectedDate > goal.deadline));
  });
  const goalViolation = state.goals.some((goal, index) => {
    const impact = goalImpacts[index];
    if (!impact) return false;
    if (goal.deadline && (!impact.projectedDate || impact.projectedDate > goal.deadline)) return true;
    return impact.baselineDate !== null && (impact.projectedDate === null || (impact.delayDays ?? 0) > (goal.maxDelayDays ?? 0));
  });
  const billsCovered = days.every(day => day.billsCovered);
  const safetyBufferViolation = days.some(day => day.safetyBufferViolation);
  return { days, minimumBalanceCents, minimumBalanceDate, finalBalanceCents: lastDay.closingBalanceCents,
    billsCovered, safetyBufferViolation, goalImpacts, proposedPurchaseDate,
    verdict: minimumBalanceCents < 0 || !billsCovered || safetyBufferViolation || goalDeadlineViolation ? 'NOT_RECOMMENDED' : goalViolation ? 'CAUTION' : 'SAFE' };
}

function validateScenario(state: FinancialState, purchase?: Purchase, purchaseDate?: string): string | null {
  validateState(state);
  if (!purchase) {
    if (purchaseDate !== undefined) throw new RangeError('A purchase date requires a purchase.');
    return null;
  }
  validatePurchase(purchase);
  const date = purchaseDate ?? state.startDate;
  assertDate(date);
  if (date < state.startDate || daysBetween(state.startDate, date) >= state.horizonDays) {
    throw new RangeError('Purchase date must fall within the forecast horizon.');
  }
  return date;
}

export function simulate(state: FinancialState, purchase?: Purchase, purchaseDate?: string): SimulationResult {
  const date = validateScenario(state, purchase, purchaseDate);
  const baselineDays = forecast(state);
  const baselineDates = goalDates(state, baselineDays);
  return result(state, purchase && date ? forecast(state, purchase, date) : baselineDays, baselineDates, date);
}

export function analyze(state: FinancialState, purchase: Purchase): AnalysisResult {
  validateScenario(state, purchase);
  const baselineDays = forecast(state);
  const baselineDates = goalDates(state, baselineDays);
  const baseline = result(state, baselineDays, baselineDates, null);
  const candidate = (price: number, date: string) => result(state, forecast(state, { ...purchase, priceCents: price }, date), baselineDates, date);
  const today = candidate(purchase.priceCents, state.startDate);
  let safeDate: string | null = today.verdict === 'SAFE' ? state.startDate : null;
  let wait: SimulationResult | null = null;
  // Search each day; never assume date safety is monotonic.
  for (let index = 1; safeDate === null && index < state.horizonDays; index += 1) {
    const date = addDays(state.startDate, index);
    const simulation = candidate(purchase.priceCents, date);
    if (simulation.verdict === 'SAFE') { safeDate = date; wait = simulation; }
  }
  let safeMaximumCents: number | null = null;
  if (candidate(0, state.startDate).verdict === 'SAFE') {
    let low = 0;
    // A purchase reduces every subsequent closing balance by its exact price.
    let high = Math.max(0, addCents(Math.min(...baselineDays.map(day => day.closingBalanceCents)), -state.safetyBufferCents));
    while (low < high) {
      const middle = low + Math.ceil((high - low) / 2);
      if (candidate(middle, state.startDate).verdict === 'SAFE') low = middle;
      else high = middle - 1;
    }
    safeMaximumCents = low;
  }
  const reasons: string[] = [];
  if (!today.billsCovered) reasons.push('Buying today leaves a mandatory bill without enough cash on its due date.');
  if (today.minimumBalanceCents < 0) reasons.push(`Buying today projects a negative balance of ${formatMoney(today.minimumBalanceCents)} on ${today.minimumBalanceDate}.`);
  if (today.safetyBufferViolation) reasons.push(`Buying today takes spendable cash below your ${formatMoney(state.safetyBufferCents)} safety buffer.`);
  if (today.goalImpacts.some(impact => {
    const goal = state.goals.find(item => item.id === impact.goalId);
    return goal && ((goal.deadline && (!impact.projectedDate || impact.projectedDate > goal.deadline)) || (impact.baselineDate !== null && (impact.projectedDate === null || (impact.delayDays ?? 0) > (goal.maxDelayDays ?? 0))));
  })) reasons.push('Buying today exceeds a goal delay tolerance or misses a goal deadline.');
  if (safeDate === state.startDate) reasons.push('Buying today covers mandatory bills, preserves the buffer, and satisfies goal constraints throughout this forecast.');
  else if (safeDate) reasons.push(`The earliest date satisfying all forecast constraints is ${safeDate}.`);
  else reasons.push(`No safe purchase date was found within the ${state.horizonDays}-day forecast.`);
  return { baseline, today, wait, safeDate, safeMaximumCents,
    waitDays: safeDate === null ? null : daysBetween(state.startDate, safeDate), reasons };
}
