import type { DashboardData } from '@/types/api';
import { money, shortDate } from '@/lib/display';
import { Target } from 'lucide-react';

export function GoalImpactCard({ data }: {data: DashboardData}) {
  if (!data.profile.goals.length) return null;
  return <section className="goals-summary panel"><div className="section-heading"><div><div className="eyebrow">THE BIGGER PICTURE</div><h2>Keep the things that matter in reach.</h2></div><Target size={22}/></div>
    {data.profile.goals.map(goal=>{
      const today=data.analysis.today.goalImpacts.find(impact=>impact.goalId===goal.id);
      const wait=data.analysis.wait?.goalImpacts.find(impact=>impact.goalId===goal.id);
      return <div key={goal.id} className="goal-row"><div><strong>{goal.name}</strong><span>{money(goal.savedCents)} saved of {money(goal.targetCents)}</span><progress value={goal.savedCents} max={goal.targetCents || 1} aria-label={`${goal.name} savings progress`}/></div><div><span>Without purchase</span><b>{shortDate(today?.baselineDate??null)}</b></div><div><span>Buy today</span><b>{shortDate(today?.projectedDate??null)}</b></div><div><span>Buy on Safe Date</span><b>{shortDate(wait?.projectedDate??(data.analysis.safeDate===data.profile.startDate?today?.projectedDate??null:null))}</b></div></div>;
    })}
  </section>;
}
