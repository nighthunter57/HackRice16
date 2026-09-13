'use client';

import {useBrowserSession} from './use-browser-session';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { z } from 'zod';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, Clock3, Headphones, Leaf, LoaderCircle, ScanLine, ShieldCheck, Sparkles, Target, Wallet, Wrench, X, CalendarDays, History, SlidersHorizontal } from 'lucide-react';
import { scanResultSchema, type ScanResult } from '@/types/scan';
import type { DashboardData } from '@/types/api';
import type { SimulationResult } from '@/types/finance';
import { money, shortDate, dollarsToCents } from '@/lib/display';
import { CashFlowChart } from './CashFlowChart';
import { GoalImpactCard } from './GoalImpactCard';
import { balanceImpactRows, balanceImpactExplanation } from '@/lib/balance-impact';
import type { BalanceImpact } from '@/types/finance';
import {prepareBrowserImage} from '@/lib/image/browser';

interface Decision { id: string; item: string; priceCents: number; decision: 'WAIT' | 'BUY'; date: string; verdict: string }
const decisionSchema = z.object({id:z.string(),item:z.string(),priceCents:z.number().int().nonnegative(),decision:z.enum(['WAIT','BUY']),date:z.string(),verdict:z.string()});
function storedDecisions(userId='demo'): Decision[] {
  const parsed = z.array(decisionSchema).safeParse(JSON.parse(localStorage.getItem(`canibuyit-decisions:${userId}`) ?? '[]'));
  return parsed.success ? parsed.data : [];
}

export function Dashboard({initial}:{initial:DashboardData}){
  const session=useBrowserSession();
  return <DashboardContent key={session.user?.id??'demo'} initial={initial} session={session}/>;
}
function DashboardContent({ initial,session }: { initial: DashboardData;session:ReturnType<typeof useBrowserSession> }) {
  const [data, setData] = useState(initial);
  const [name, setName] = useState(initial.purchase.productName);
  const [price, setPrice] = useState((initial.purchase.priceCents / 100).toFixed(2));
  const [category, setCategory] = useState('electronics');
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'manual' | 'describe'>('manual');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [matches, setMatches] = useState<ScanResult | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [priceConfirmed, setPriceConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [repair, setRepair] = useState(false);
  const [settings, setSettings] = useState(false);
  const [history, setHistory] = useState<Decision[] | null>(null);
  const [horizon, setHorizon] = useState(60);
  const [buffer, setBuffer] = useState('400');
  const mode = data.dataSource === 'nessie' ? 'live' : 'demo';
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');
  const [priority, setPriority] = useState('experiences');
  const fileInput = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const safe = data.analysis.today.verdict === 'SAFE';
  const requestHeaders = () => ({'Content-Type':'application/json'});

  async function savePriority() {
    setError('');
    try {
      const response = await session.apiFetch('/api/preferences',{method:'POST',headers:requestHeaders(),body:JSON.stringify({key:'spendingPriority',value:priority})});
      if (!response.ok) { setNotice('Your preference is applied for this session. We couldn’t save it for next time.'); }
      else setNotice('Preference saved.');
      setData(previous=>({...previous,preferences:[priority==='experiences'?'You prioritize experiences and travel over discretionary purchases.':priority==='saving'?'You prioritize building savings. Compare goal dates before deciding.':'You prioritize essentials and upcoming obligations.']}));
    } catch { setError('Could not save this preference. Please try again.'); }
  }

  async function analyzePurchase(withRepair = repair, reset = false) {
    if (scanning || (matches && matches.candidates.length > 0) || (needsConfirmation && !priceConfirmed)) { setNotice('Select your item and confirm its price first.'); return; }
    const priceCents = reset ? initial.purchase.priceCents : dollarsToCents(price);
    const safetyBufferCents = dollarsToCents(buffer);
    if (priceCents === null || safetyBufferCents === null || !name.trim()) { setError('Enter an item name and a valid dollar amount with no more than two decimal places.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await session.apiFetch('/api/analyze', { method: 'POST', headers: requestHeaders(), body: JSON.stringify({ purchase: {productName: reset ? initial.purchase.productName : name, priceCents, category, purchaseType: 'discretionary'}, horizonDays: horizon, safetyBufferCents, repair: withRepair, mode, previousSnapshotId: data.snapshotId }) });
      if (!response.ok) throw new Error(response.status === 401 ? 'Sign in through Settings to update your financial forecast.' : 'The forecast could not be updated. Please try again.');
      const next: DashboardData = await response.json();
      setData(previous=>({...next,services:next.services.map(service=>service.name==='Gemini'&&previous.services.some(old=>old.name==='Gemini'&&old.mode==='live')?{...service,mode:'live',detail:'Last product extraction succeeded. Financial calculations use confirmed input.'}:service)})); setRepair(withRepair);
      if (reset) { setName(initial.purchase.productName); setPrice((initial.purchase.priceCents / 100).toFixed(2)); }
      if (window.innerWidth < 800) result.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Something went wrong. Your last forecast is still shown.'); }
    finally { setBusy(false); }
  }

  async function extract(image?: File) {
    const started=performance.now();
    setScanning(true); setError(''); setNotice(''); setMatches(null); setName(''); setPrice(''); setNeedsConfirmation(true); setPriceConfirmed(false);
    try {
      if (image && (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type) || image.size > 32 * 1024 * 1024)) throw new Error('Choose a JPG, PNG, or WebP image under 32 MB.');
      const prepared=image?await prepareBrowserImage(image):undefined;
      if(prepared && prepared.optimizedBytes>4*1024*1024)throw new Error('Choose a smaller photo or enter the item manually.');
      const uploadStarted=performance.now();
      const response = await session.apiFetch('/api/extract', { method: 'POST', headers:requestHeaders(), signal:AbortSignal.timeout(45_000), body:JSON.stringify({text: image ? undefined : text, imageBase64:prepared?.imageBase64, mimeType:prepared?.mimeType}) });
      console.info('[recognition.web]',{stage:'complete',sourceType:image?'upload':'text',imageMimeType:prepared?.mimeType??null,imageWidth:prepared?.width??null,imageHeight:prepared?.height??null,originalBytes:prepared?.originalBytes??0,optimizedBytes:prepared?.optimizedBytes??0,uploadMs:Math.round(performance.now()-uploadStarted),totalRecognitionMs:Math.round(performance.now()-started)});
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Product understanding is unavailable. Enter the item and price manually.');
      const scan = scanResultSchema.parse(payload);
      setMatches(scan); setTab('manual');
      setNotice([scan.candidates.length ? 'We found a few possible matches.' : 'No clear match yet. Try another photo or enter your item.', ...scan.warnings].join(' '));
      setData(previous=>({...previous,services:previous.services.map(service=>service.name==='Gemini'?{...service,mode:'live',detail:'Product extracted by Gemini and awaiting your confirmation.'}:service)}));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to understand this product. Manual entry is always available.'); setTab('manual'); }
    finally { setScanning(false); }
  }

  async function saveDecision(decision: 'WAIT' | 'BUY') {
    const entry: Decision = {id: crypto.randomUUID(), item: data.purchase.productName, priceCents: data.purchase.priceCents, decision, date: new Date().toISOString(), verdict: data.analysis.today.verdict};
    try {
      const previous = storedDecisions(session.user?.id);
      localStorage.setItem(`canibuyit-decisions:${session.user?.id??'demo'}`, JSON.stringify([entry, ...previous].slice(0, 50)));
      setNotice('Decision saved on this device.');
      const response = await session.apiFetch('/api/decisions', {method:'POST', headers:requestHeaders(), body:JSON.stringify({...entry,source:data.services.find(s=>s.name==='Nessie')?.mode==='live'?'nessie':'demo',safeDate:data.analysis.safeDate})});
      if (response.ok) { const saved = await response.json(); setNotice(saved.persisted ? 'Decision saved to your history.' : 'Decision saved on this device.'); }
    } catch { setNotice('Cloud history is unavailable. Check whether this browser permits local storage.'); }
  }

  function openHistory() {
    try { setHistory(storedDecisions(session.user?.id)); }
    catch { setHistory([]); }
  }

  return <>
    <header className="site-header"><Link className="wordmark" href="/" aria-label="Spendly home"><span className="spendly-symbol"><Image src="/spendly-logo.png" alt="" width={120} height={120}/></span>Spendly</Link>
      <nav aria-label="Main navigation"><span className="nav-current">Your next purchase</span><button onClick={openHistory}><History size={15}/>Decision history</button></nav>
      <button className="profile-button" onClick={() => setSettings(!settings)} aria-expanded={settings}><span className="avatar">{session.user?.name.slice(0,1).toUpperCase()??'C'}</span><span>{mode === 'demo' ? 'Sample finances' : session.user?.name??'Your account'}</span><ChevronDown size={14}/></button></header>
    <main className="page-shell">
      <section className="hero"><div><div className="eyebrow hero-eyebrow"><span className="tiny-star">✳</span>A LITTLE FORESIGHT GOES A LONG WAY</div><h1>Want it now.<br/><span>Buy it at the right time.</span></h1><p>See your financial future before you spend.</p></div><div className="safe-spend"><div><ShieldCheck size={17}/>PROJECTED SAFE TO SPEND TODAY</div><strong>{data.analysis.safeMaximumCents === null ? '—' : money(data.analysis.safeMaximumCents, true)}</strong><span>After your bills, goals & safety reserve <ArrowUpRight size={14}/></span></div></section>
      {settings && <section className="settings panel" aria-label="Forecast settings"><div><h2>Make the forecast yours.</h2><p>Changes apply when you analyze the purchase.</p></div><label>Safety reserve ($)<input inputMode="decimal" value={buffer} onChange={e=>setBuffer(e.target.value)}/></label><label>Forecast horizon<select value={horizon} onChange={e=>setHorizon(Number(e.target.value))}><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option></select></label><div><span>Financial Data</span><p>{data.dataSource === 'demo' ? 'Sample finances' : 'Account balances'}</p></div></section>}
      {settings && <section className="settings panel" aria-label="Preferences and account"><label>Your priority<select value={priority} onChange={e=>setPriority(e.target.value)}><option value="experiences">Travel & experiences</option><option value="saving">Building savings</option><option value="essentials">Essentials first</option></select></label><button className="secondary-button" onClick={()=>void savePriority()}>Save preference</button>{session.user?<><span>{session.user.name}</span><button className="secondary-button" onClick={()=>void session.logout().then(()=>{setData(initial);setHistory(null);setNotice('Signed out. Showing sample finances.');}).catch(()=>setError('Could not sign out. Please try again.'))}>Sign Out</button></>:<form onSubmit={event=>{event.preventDefault();setError('');void session.login(email.trim().toLowerCase(),password).then(()=>{setPassword('');setNotice('Signed in. Check your purchase to load your finances.');}).catch(cause=>setError(cause instanceof Error?cause.message:'Unable to sign in.'));}}><label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="secondary-button" type="submit">Sign In</button><a href="spendly://sign-up">Create an account</a></form>}</section>}
      <div className="workspace-grid">
        <aside className="purchase-panel panel">
          <div className="step-label"><span>01</span>THE THING YOU’VE BEEN EYEING</div>
          <div className="product-art"><div className="art-ring ring-one"/><div className="art-ring ring-two"/><Headphones size={126} strokeWidth={1.1}/><span className="product-art-note">A little more joy.<br/>A little less guesswork.</span><span className="art-badge"><Sparkles size={12}/>YOUR NEXT WANT</span></div>
          <div className="input-tabs"><button className={tab==='manual'?'selected':''} onClick={()=>setTab('manual')}>Enter an item</button><button className={tab==='describe'?'selected':''} onClick={()=>setTab('describe')}><Sparkles size={13}/>Describe it</button></div>
          {matches && matches.candidates.length > 0 ? <section className="scan-matches" aria-label="Possible matches"><h2>Possible matches</h2><p className="small">We found a few possible matches.</p>{matches.candidates.map((item, index) => <article className="panel scan-match" key={`${item.productName}-${index}`}>{item.imageUrl && <Image unoptimized src={item.imageUrl} alt={item.productName} width={120} height={100}/>}<h3>{item.productName}</h3><p>{item.priceCents !== null ? money(item.priceCents) : item.priceRange ? `${money(item.priceRange.minCents)} – ${money(item.priceRange.maxCents)}` : 'Enter price after selecting'}</p>{item.priceSource==='catalog' && <p className="small">Listed price</p>}<button className="primary-button" onClick={() => { setName(item.productName); setPrice(item.priceCents === null ? '' : (item.priceCents / 100).toFixed(2)); setCategory(['electronics','clothing','travel','home'].includes(item.category) ? item.category : 'other'); setMatches(null); setNotice('Confirm your item and total price before analysis.'); }}>Select</button></article>)}<button className="secondary-button" onClick={() => { setMatches(null); setName(''); setPrice(''); setNotice('Enter the item and price you expect to pay.'); }}>None of these</button></section> : tab === 'manual' ? <form onSubmit={e=>{e.preventDefault();void analyzePurchase();}}>
            <label>What are you thinking of buying?<input value={name} onChange={e=>{setName(e.target.value);setPriceConfirmed(false);}} maxLength={120} placeholder="Sony headphones" required/></label>
            <div className="price-category"><label>Price ($)<input value={price} onChange={e=>{setPrice(e.target.value);setPriceConfirmed(false);}} inputMode="decimal" placeholder="449.00" required/></label><label>Category<select value={category} onChange={e=>setCategory(e.target.value)}><option value="electronics">Electronics</option><option value="clothing">Clothing</option><option value="travel">Travel</option><option value="home">Home</option><option value="other">Other</option></select></label></div>
            {needsConfirmation && <label className="scan-confirm"><input type="checkbox" checked={priceConfirmed} onChange={e => setPriceConfirmed(e.target.checked)} required/>I confirm this product and total USD price, including tax and shipping.</label>}
            <button className="primary-button analyze-button" disabled={busy || scanning || (needsConfirmation && !priceConfirmed)} type="submit">{busy?<LoaderCircle className="spin" size={17}/>:<Sparkles size={17}/>} {busy?'Mapping your future…':'See my financial future'}{!busy && <ArrowRight size={17}/>}</button>
          </form> : <div className="describe-entry"><label>Tell us what caught your eye<textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Can I buy these Sony headphones for around $450?" maxLength={1500}/></label><button className="primary-button" disabled={scanning || !text.trim()} onClick={()=>void extract()}>{scanning?<LoaderCircle className="spin" size={16}/>:<Sparkles size={16}/>}Find my item</button></div>}
          <div className="or-rule"><span>or let a picture do the talking</span></div><input type="file" className="visually-hidden" ref={fileInput} accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Upload a product photo" onChange={e=>{const file=e.target.files?.[0];if(file) void extract(file);e.target.value='';}}/>
          <button className="scan-button" disabled={scanning || busy} onClick={()=>fileInput.current?.click()}><ScanLine size={18}/>{scanning?'Reading your product…':'Scan or upload a product'}<span>GEMINI</span></button>
          <div className="input-note"><ShieldCheck size={13}/>Your numbers are calculated, never AI-guessed.</div>
        </aside>
        <section className="results" ref={result} aria-live="polite" aria-busy={busy}>
          <div><h2>{data.purchase.productName}</h2><p>{money(data.purchase.priceCents,true)}</p></div>
          <div className={`verdict-panel ${safe?'verdict-safe':''}`}><div className="verdict-top"><div className="step-label"><span>02</span>HERE’S WHAT YOUR FUTURE SAYS</div><span className="projection-pill">{data.profile.horizonDays}-DAY PROJECTION</span></div>
            <div className="verdict-body"><div><div className="verdict-word">{safe?'Go ahead.':data.analysis.safeDate?'Worth the wait.':'Not safe yet.'}<span>{safe?<CheckCircle2 size={28}/>:<Clock3 size={28}/>}</span></div><p>{balanceImpactExplanation(data.analysis.today.balanceImpact)}</p></div></div>
            <BalanceImpactDetails impact={data.analysis.today.balanceImpact}/>
            <div className="safe-date-row"><div className="calendar-icon"><CalendarDays size={23}/></div><div><span>EARLIEST SAFE DATE</span><strong>{data.analysis.safeDate ? shortDate(data.analysis.safeDate,true) : `No safe date in ${data.profile.horizonDays} days`}</strong></div>{data.analysis.waitDays !== null && <div className="wait-chip">{data.analysis.waitDays===0?'Safe today':`Wait ${data.analysis.waitDays} days`}<ArrowRight size={14}/></div>}</div>
          </div>
          <div className="comparison-header"><h2>One purchase. Two futures.</h2><span>FutureMe <Sparkles size={13}/></span></div>
          <div className="comparison-grid"><ScenarioCard title="Buy today" subtitle={shortDate(data.profile.startDate)} scenario={data.analysis.today} tone="today" buffer={data.profile.safetyBufferCents}/><ScenarioCard title={data.analysis.waitDays===0?'Your baseline':'Wait for your Safe Date'} subtitle={data.analysis.safeDate?shortDate(data.analysis.safeDate):'No safe date found'} scenario={data.analysis.waitDays===0?data.analysis.baseline:data.analysis.wait} tone="wait" buffer={data.profile.safetyBufferCents}/></div>
          <div className="reason-strip"><Leaf size={19}/><p>{data.explanation}</p></div>
        </section>
      </div>
      {error && <div role="alert" className="message error"><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
      {notice && <div role="status" className="message notice"><span>{notice}</span><button aria-label="Dismiss notification" onClick={()=>setNotice('')}><X size={16}/></button></div>}
      <CashFlowChart analysis={data.analysis} buffer={data.profile.safetyBufferCents}/>
      <GoalImpactCard data={data}/>
      <div className="detail-grid"><section className="obligations panel"><div className="section-heading"><div><div className="eyebrow">ALREADY SPOKEN FOR</div><h2>Your money has plans.</h2></div><Wallet size={21}/></div><div className="obligation-row"><div className="event-icon green-soft"><Wallet size={16}/></div><div><strong>Available account balance</strong><span>Before this purchase</span></div><b>{money(data.profile.accounts.filter(a=>a.type==='checking').reduce((sum,a)=>sum+a.balanceCents,0),true)}</b></div>{data.profile.bills.slice(0,3).map(bill=><div className="obligation-row" key={bill.id}><div className="event-icon"><CalendarDays size={16}/></div><div><strong>{bill.name}</strong><span>{shortDate(bill.dueDate)} · {bill.recurrence}</span></div><b>−{money(bill.amountCents,true)}</b></div>)}<div className="obligation-row"><div className="event-icon"><ShieldCheck size={16}/></div><div><strong>Your safety reserve</strong><span>The line we keep an eye on</span></div><b>{money(data.profile.safetyBufferCents,true)}</b></div></section>
      <section className="change-panel panel"><div className="section-heading"><div><div className="eyebrow">LIFE HAPPENS. YOUR FORECAST ADAPTS.</div><h2>What if plans change?</h2></div><Wrench size={21}/></div><p>A surprise expense today can change when it’s safe to buy. See the effect, down to the day.</p><div className="repair-example"><span className="event-icon"><Wrench size={18}/></span><div><strong>Unexpected car repair</strong><span>One expense. A new financial future.</span></div><b>−$430</b></div><button className="secondary-button" disabled={busy || mode==='live'} onClick={()=>void analyzePurchase(!repair)}>{busy?<LoaderCircle className="spin" size={15}/>:repair?<Check size={16}/>:<ArrowUpRight size={16}/>} {repair?'Remove expense & restore forecast':'Add expense & recalculate'}</button>{mode==='live' && <p className="small">Available with sample finances.</p>}{data.change && <div className="causal-change"><span>WHAT CHANGED?</span><div><strong>{shortDate(data.change.previousSafeDate)}</strong><ArrowRight size={16}/><strong>{shortDate(data.change.newSafeDate)}</strong></div>{data.change.causes.map((cause,i)=><p key={i}>{cause.label} <b>{cause.amountCents >= 0 ? '−' : '+'}{money(Math.abs(cause.amountCents),true)}</b></p>)}<small>{data.change.differenceDays === null?'A safe date is outside the forecast.':data.change.differenceDays === 0?'Your Safe Date hasn’t changed.':`Safe Date moved ${data.change.differenceDays} days.`}</small></div>}</section></div>
      <section className="memory-panel"><div className="memory-icon"><Target size={24}/></div><div><div className="eyebrow">A FUTURE THAT FEELS LIKE YOU</div><h2>Your priorities stay in the picture.</h2><p>{data.preferences[0] ?? 'Protect your safety reserve and make room for the things you care about.'}</p></div><div className="decision-actions"><button className="secondary-button" onClick={()=>void saveDecision('WAIT')}>I’ll wait <Clock3 size={15}/></button><button className="text-button" onClick={()=>void saveDecision('BUY')}>Record buy decision <ArrowUpRight size={14}/></button></div></section>
      <div className="service-status"><button onClick={()=>setSettings(!settings)}><SlidersHorizontal size={13}/>Settings</button></div>
      <footer><Link className="wordmark small-brand" href="/">Spendly</Link><span>Spend with confidence.</span></footer>
    </main>
    {history !== null && <HistoryDialog history={history} onClose={()=>setHistory(null)}/>}
  </>;
}

function HistoryDialog({history,onClose}:{history:Decision[];onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(dialog.current && !dialog.current.open) dialog.current.showModal();},[]);
  return <dialog ref={dialog} className="history-dialog" onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose();}} aria-labelledby="history-title"><section className="history-modal panel"><div className="section-heading"><h2 id="history-title">Your decisions, remembered.</h2><button autoFocus aria-label="Close history" onClick={onClose}><X size={20}/></button></div><p className="small">Decision history saved on this device.</p>{history.length===0?<div className="empty-history"><History size={30}/><p>No decisions yet. Choose “I’ll wait” or “Record buy decision” to save your first one.</p></div>:history.map(item=><div className="history-row" key={item.id}><div><strong>{item.item}</strong><span>{item.date.slice(0,10)} · {money(item.priceCents,true)}</span></div><b>{item.decision}</b></div>)}</section></dialog>;
}

function ScenarioCard({title,subtitle,scenario,tone,buffer}:{title:string;subtitle:string;scenario:SimulationResult|null;tone:'today'|'wait';buffer:number}) {
  const goal = scenario?.goalImpacts[0];
  return <article className={`scenario-card ${tone}`}><div className="scenario-title"><div><h3>{title}</h3><span>{subtitle}</span></div>{tone==='wait'?<CheckCircle2 size={19}/>:<Clock3 size={19}/>}</div>{scenario && <BalanceImpactDetails impact={scenario.balanceImpact}/>}<div className="buffer-track"><span style={{width:scenario?`${Math.max(0,Math.min(100,buffer===0?100:scenario.minimumBalanceCents/buffer*100))}%`:'0%'}}/></div><div className="scenario-detail"><span>Safety reserve</span><b>{!scenario?'Not found':scenario.safetyBufferViolation?'Below reserve':'Protected'}</b></div><div className="scenario-detail"><span>Bills</span><b>{!scenario?'—':scenario.billsCovered?'Covered':'At risk'}</b></div><div className="scenario-detail"><span>{goal?.name ?? 'Savings goal'}</span><b>{!goal?'—':goal.delayDays===null?'Beyond this forecast':goal.delayDays===0?'On track':`+${goal.delayDays} days`}</b></div><div className={`scenario-verdict ${scenario?.verdict==='SAFE'?'positive':''}`}>{!scenario?'NO SAFE DATE YET':scenario.verdict==='SAFE'?<><Check size={12}/>SAFE TO BUY</>:<><ArrowDown size={12}/>{scenario.verdict==='CAUTION'?'MAY DELAY YOUR GOAL':'NOT RECOMMENDED'}</>}</div></article>;
}

function BalanceImpactDetails({impact}: {impact: BalanceImpact}) {
  return <dl className="balance-impact">{balanceImpactRows(impact).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>;
}
