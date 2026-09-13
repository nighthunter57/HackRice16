import type { AnalysisResult } from '../../types/finance';
import { formatMoney } from './money';

/** Evidence from the simulated event timeline, including recurring bill occurrences. */
export function whyWait(analysis:AnalysisResult) {
  const today = analysis.today;
  const breach = today.days.find(day=>day.safetyBufferViolation || !day.billsCovered);
  const bills = breach ? today.days.filter(day=>day.date<=breach.date).flatMap(day=>
    day.events.filter(event=>event.type==='bill' || event.type==='transaction' && event.mandatory && event.amountCents<0).map(event=>({id:`${day.date}:${event.id}`,name:event.name,date:day.date,amountCents:-event.amountCents}))) : [];
  const immediate = today.balanceImpact.immediateBalanceAfterPurchaseCents;
  const explanation = today.verdict === 'SAFE'
    ? 'This purchase fits your forecast while protecting your reserve and goal limits.'
    : immediate < 0
      ? `The purchase exceeds your current spendable balance by ${formatMoney(-immediate)}.`
      : breach
        ? `You have enough for the purchase now. By ${breach.date}, projected bills and spending would bring your cash below your ${formatMoney(today.balanceImpact.safetyBufferCents)} reserve. Income expected by then is included.`
        : 'Your cash reserve is protected, but this purchase exceeds a savings-goal deadline or allowed delay.';
  return {explanation,breachDate:breach?.date??null,bills:bills.sort((a,b)=>b.amountCents-a.amountCents).slice(0,3)};
}
