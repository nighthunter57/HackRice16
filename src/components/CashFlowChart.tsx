'use client';

import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import type { AnalysisResult } from '@/types/finance';
import { money, shortDate } from '@/lib/display';

export function CashFlowChart({ analysis, buffer }: { analysis: AnalysisResult; buffer: number }) {
  const [range, setRange] = useState(30);
  const points = analysis.baseline.days.slice(0, range).map((day, index) => ({
    date: day.date,
    baseline: day.closingBalanceCents,
    today: analysis.today.days[index].closingBalanceCents,
    wait: analysis.wait?.days[index].closingBalanceCents,
  }));
  return <section className="chart-panel panel" aria-labelledby="timeline-title">
    <div className="section-heading"><div><div className="eyebrow">YOUR FUTURE, SIDE BY SIDE</div><h2 id="timeline-title">A purchase changes the path.</h2></div>
      <div className="segmented" aria-label="Chart time range">{[30, 60, 90].filter(days => days <= analysis.baseline.days.length).map(days => <button key={days} aria-pressed={range === days} className={range === days ? 'active' : ''} onClick={() => setRange(days)}>{days} days</button>)}</div></div>
    <div className="chart-legend"><span><i className="dot gray"/>Without purchase</span><span><i className="dot coral"/>Buy today</span>{analysis.wait && <span><i className="dot green"/>Buy on Safe Date</span>}</div>
    <div className="chart-container" role="img" aria-label={`Projected cash flow. Buying today reaches ${money(analysis.today.minimumBalanceCents, true)}. Required reserve ${money(buffer, true)}. Safe date ${shortDate(analysis.safeDate)}.`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={points} margin={{ top: 12, right: 25, bottom: 0, left: 0 }} accessibilityLayer>
          <CartesianGrid stroke="#eceee8" vertical={false}/>
          <XAxis dataKey="date" tickFormatter={date => shortDate(String(date))} minTickGap={48} tickLine={false} axisLine={false} tick={{fill: '#7d857b', fontSize: 11}} dy={12}/>
          <YAxis tickFormatter={value => money(Number(value))} tickLine={false} axisLine={false} tick={{fill: '#7d857b', fontSize: 11}} width={65}/>
          <Tooltip labelFormatter={label => shortDate(String(label), true)} formatter={(value, name) => [money(Number(value), true), name]} contentStyle={{borderRadius: 12, border: '1px solid #dde3d8', fontSize: 12}}/>
          <ReferenceLine y={buffer} stroke="#ae9451" strokeDasharray="4 4" label={{value: 'SAFETY RESERVE', position: 'insideTopRight', fill: '#94772d', fontSize: 9}}/>
          {analysis.safeDate && points.some(p => p.date === analysis.safeDate) && <ReferenceLine x={analysis.safeDate} stroke="#aac6b6" strokeDasharray="3 5"/>}
          <Line name="Without purchase" type="linear" dataKey="baseline" stroke="#b2bdb5" strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false}/>
          <Line name="Buy today" type="linear" dataKey="today" stroke="#d77f64" strokeWidth={2.5} dot={false} isAnimationActive={false}/>
          {analysis.wait && <Line name="Buy on Safe Date" type="linear" dataKey="wait" stroke="#226449" strokeWidth={3} dot={false} isAnimationActive={false}/>}
        </LineChart>
      </ResponsiveContainer>
    </div>
    <div className="timeline-events">{analysis.baseline.days.slice(0,10).flatMap(day=>day.events.filter(event=>event.type==='bill'||event.type==='income').map(event=><div key={`${day.date}:${event.id}`}><span>{shortDate(day.date)}</span><strong>{event.name}</strong><b className={event.amountCents>0?'income-amount':''}>{event.amountCents>0?'+':''}{money(event.amountCents,true)}</b></div>))}<div><span>Next 7 days</span><strong>Expected everyday spending</strong><b>{money(analysis.baseline.days.slice(0,7).reduce((sum,day)=>sum+day.expectedSpendingCents,0),true)}</b></div></div>
    <details className="data-disclosure"><summary>View daily numbers</summary><div className="table-scroll"><table><thead><tr><th>Date</th><th>No purchase</th><th>Buy today</th><th>Buy on Safe Date</th></tr></thead><tbody>{points.map(p => <tr key={p.date}><td>{shortDate(p.date)}</td><td>{money(p.baseline, true)}</td><td>{money(p.today, true)}</td><td>{p.wait === undefined ? '—' : money(p.wait, true)}</td></tr>)}</tbody></table></div></details>
  </section>;
}
