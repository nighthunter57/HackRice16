import type { BalanceImpact } from '../types/finance';
import { formatMoney } from './finance/money';

export function balanceImpactRows(impact: BalanceImpact) {
  return [
    { label: 'Current spendable balance', value: formatMoney(impact.currentBalanceCents) },
    ...(impact.isFuturePurchase ? [{ label: 'Projected balance before purchase', value: formatMoney(impact.balanceBeforePurchaseCents) }] : []),
    { label: 'Purchase', value: impact.purchasePriceCents === 0 ? formatMoney(0) : `-${formatMoney(impact.purchasePriceCents)}` },
    { label: impact.purchaseDate === null ? 'Balance without purchase' : impact.isFuturePurchase ? 'Balance after purchase on planned date' : 'Balance after purchase', value: formatMoney(impact.immediateBalanceAfterPurchaseCents) },
    { label: 'Projected lowest balance', value: formatMoney(impact.projectedMinimumBalanceCents) },
    { label: 'Safety buffer', value: formatMoney(impact.safetyBufferCents) },
    { label: impact.bufferDifferenceCents < 0 ? 'Shortfall' : 'Above safety buffer', value: `${impact.bufferDifferenceCents > 0 ? '+' : ''}${formatMoney(impact.bufferDifferenceCents)}` },
  ];
}

export function balanceImpactExplanation(impact: BalanceImpact): string {
  const immediate = formatMoney(impact.immediateBalanceAfterPurchaseCents);
  const minimum = formatMoney(impact.projectedMinimumBalanceCents);
  const buffer = formatMoney(impact.safetyBufferCents);
  const relation = impact.bufferDifferenceCents < 0 ? 'below' : impact.bufferDifferenceCents === 0 ? 'equal to' : 'above';
  if (impact.purchaseDate === null) return `Without this purchase, your projected lowest balance is ${minimum}, ${relation} your ${buffer} safety reserve.`;
  const timing = impact.isFuturePurchase ? 'after buying on the planned date' : 'immediately after buying this';
  return `You would have ${immediate} ${timing}. With upcoming bills, income, and expected spending, your projected lowest balance is ${minimum}, ${relation} your ${buffer} safety reserve.`;
}
