import type { FinancialState } from '../../types/finance';
/** Provider/customer identity is internal; the authenticated application user owns normalized data. */
export function ownedState(state:FinancialState,userId:string):FinancialState {
  const own=<T extends {userId:string}>(items:T[])=>items.map(item=>({...item,userId}));
  return {...state,userId,accounts:own(state.accounts),transactions:own(state.transactions),bills:own(state.bills),incomeEvents:own(state.incomeEvents),goals:own(state.goals)};
}
