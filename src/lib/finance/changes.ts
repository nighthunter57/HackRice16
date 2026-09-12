import type { FinancialState, Purchase } from '../../types/finance';
import type { SafeDateChange } from '../../types/api';
import { analyze, dateFromTimestamp, daysBetween } from './index';
import { addCents } from './money';

/** Compare the same purchase/settings against two financial states. */
export function forecastChange(previous: FinancialState, current: FinancialState, purchase: Purchase): SafeDateChange | null {
  if (previous.userId !== current.userId || previous.startDate !== current.startDate ||
      previous.horizonDays !== current.horizonDays || previous.safetyBufferCents !== current.safetyBufferCents) return null;
  const causes: SafeDateChange['causes'] = [];
  const oldBills = new Map(previous.bills.map(b => [b.id,b]));
  for (const bill of current.bills) {
    const old = oldBills.get(bill.id);
    if (!old || old.amountCents !== bill.amountCents || old.dueDate !== bill.dueDate)
      causes.push({label:`${bill.name} (${bill.dueDate})`,amountCents:addCents(bill.amountCents,-(old?.amountCents??0))});
    oldBills.delete(bill.id);
  }
  for (const bill of oldBills.values()) causes.push({label:`Removed: ${bill.name}`,amountCents:-bill.amountCents});
  function categoryTotals(state: FinancialState) {
    const totals = new Map<string,number>();
    for (const tx of state.transactions) {
      const date = dateFromTimestamp(tx.timestamp);
      const age = daysBetween(date, state.startDate);
      if (tx.eventType === 'discretionary' && tx.amountCents < 0 && age >= 1 && age <= 30)
        totals.set(tx.category, addCents(totals.get(tx.category) ?? 0, -tx.amountCents));
    }
    return totals;
  }
  const oldSpending=categoryTotals(previous), newSpending=categoryTotals(current);
  for(const category of new Set([...oldSpending.keys(),...newSpending.keys()])) {
    const delta=addCents(newSpending.get(category)??0,-(oldSpending.get(category)??0));
    if(delta) causes.push({label:`${category}: historical spending change`,amountCents:delta});
  }
  const before=analyze(previous,purchase), after=analyze(current,purchase);
  if(!causes.length && before.safeDate===after.safeDate) return null;
  if(!causes.length) causes.push({label:'Other financial inputs changed',amountCents:0});
  return {previousSafeDate:before.safeDate,newSafeDate:after.safeDate,
    differenceDays:before.safeDate && after.safeDate ? daysBetween(before.safeDate,after.safeDate):null,causes};
}
