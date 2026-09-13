import type { PurchaseAnalysis } from '../../types/api';
import type { AnalysisResult } from '../../types/finance';

export function purchaseAnalysis(dataSource: PurchaseAnalysis['dataSource'], analysis: AnalysisResult): PurchaseAnalysis {
  const impact = analysis.today.balanceImpact;
  return { dataSource,
    currentBalanceCents: impact.currentBalanceCents, purchasePriceCents: impact.purchasePriceCents,
    immediateBalanceAfterPurchaseCents: impact.immediateBalanceAfterPurchaseCents,
    projectedMinimumBalanceCents: impact.projectedMinimumBalanceCents,
    safetyBufferCents: impact.safetyBufferCents, bufferDifferenceCents: impact.bufferDifferenceCents,
    verdict: analysis.today.verdict === 'SAFE' ? 'safe' : analysis.safeDate ? 'wait' : 'not_safe',
    safeDate: analysis.safeDate, waitDays: analysis.waitDays, reasons: analysis.reasons, goalImpacts: analysis.today.goalImpacts,
  };
}
