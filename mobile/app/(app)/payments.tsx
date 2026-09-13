import { useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, Field, Screen, s } from '../../components/ui';
import { useApp } from '../../lib/store';
import { dateLabel, newEntryId } from '../../lib/model';
import { dollarsToCents } from '../../../src/lib/display';
import { assertDate } from '../../../src/lib/finance/dates';
import { addCents, formatMoney } from '../../../src/lib/finance/money';
import { nextPaymentDate, removePayment, savePayment } from '../../../src/lib/finance/payments';
import type { Bill, Recurrence } from '../../../src/types/finance';

const frequencies: {value: Recurrence; label: string}[] = [
  {value:'monthly',label:'Monthly'}, {value:'weekly',label:'Weekly'},
  {value:'biweekly',label:'Every 2 weeks'}, {value:'once',label:'One time'},
];
type Draft = {id:string; name:string; amount:string; date:string; recurrence:Recurrence; userId:string; source:'demo'|'nessie'; mandatory?:boolean};

export default function Payments() {
  const app = useApp();
  const [draft,setDraft] = useState<Draft|null>(null);
  const [removing,setRemoving] = useState<Bill|null>(null);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [saving,setSaving] = useState(false);
  const busy = useRef(false);
  const locked = saving || app.loading || !app.ready;
  const payments = app.current.profile.bills.map(payment => ({payment,next:nextPaymentDate(payment,app.current.profile.startDate)}))
    .sort((a,b)=>(a.next??'9999').localeCompare(b.next??'9999') || a.payment.name.localeCompare(b.payment.name));
  const monthly = payments.filter(({payment})=>payment.recurrence==='monthly')
    .reduce((total,{payment})=>addCents(total,payment.amountCents),0);

  function edit(payment?:Bill) {
    setError(''); setMessage('');
    setDraft({id:payment?.id??newEntryId(),name:payment?.name??'',
      amount:payment ? `${Math.floor(payment.amountCents/100)}.${String(payment.amountCents%100).padStart(2,'0')}` : '',
      date:payment?.dueDate??app.current.profile.startDate,recurrence:payment?.recurrence??'monthly',
      userId:app.settings.userId,source:app.settings.dataSource,mandatory:payment?.mandatory??true});
  }
  async function commit() {
    if (locked || busy.current) return;
    busy.current=true; setSaving(true); setError('');
    try {
      let settings = app.settings;
      if (draft) {
        if (draft.userId!==settings.userId || draft.source!==settings.dataSource) throw new Error('Your spending plan changed. Reopen this payment and try again.');
        const amountCents=dollarsToCents(draft.amount);
        if (!draft.name.trim() || draft.name.trim().length>120) throw new Error('Enter a payment name, up to 120 characters.');
        if (amountCents===null || amountCents<=0) throw new Error('Enter an amount greater than zero, with up to two decimal places.');
        try { assertDate(draft.date); } catch { throw new Error('Enter a valid date as YYYY-MM-DD.'); }
        if (draft.recurrence==='once' && draft.date<app.current.profile.startDate) throw new Error('Choose an upcoming date for this one-time payment.');
        settings=savePayment(settings,{id:draft.id,userId:draft.userId,name:draft.name.trim(),amountCents,dueDate:draft.date,recurrence:draft.recurrence,mandatory:draft.mandatory});
      } else if (removing) settings=removePayment(settings,removing.id);
      else return;
      await app.saveSettings(settings);
      setMessage(removing ? 'Payment removed. Your forecast is updated.' : 'Payment saved. Your forecast is updated.');
      setDraft(null);setRemoving(null);
    } catch (cause) {
      setError(cause instanceof Error && cause.name!=='ZodError' ? cause.message : 'Couldn’t save this payment. Check your entries and try again.');
    } finally {busy.current=false;setSaving(false);}
  }
  function close() {if (!busy.current) {setDraft(null);setRemoving(null);setError('');}}
  return <Screen>
    <Text style={s.title}>Plan for what you pay.</Text>
    <Text style={s.body}>Add any upcoming payment. Give it your own name, amount, and schedule.</Text>
    <Card tint={colors.soft}>
      <Text style={s.label}>Monthly recurring payments</Text>
      <Text style={s.amount}>{formatMoney(monthly)}</Text>
      <Text style={s.body}>Weekly and one-time payments are included separately in your forecast.</Text>
    </Card>
    <Button title="Add payment" icon="plus" disabled={locked} onPress={()=>edit()}/>
    {message ? <Text accessibilityLiveRegion="polite" style={s.body}>{message}</Text> : null}
    {!payments.length ? <Card><Text style={s.heading}>What do you need to pay?</Text><Text style={s.body}>Anything from a membership to a loan payment, school fee, or custom expense.</Text></Card> : null}
    {payments.map(({payment,next})=><Card key={payment.id}>
      <Text style={s.heading}>{payment.name}</Text>
      <Text style={s.heading}>{formatMoney(payment.amountCents)}</Text>
      <Text style={s.body}>{frequencies.find(item=>item.value===payment.recurrence)?.label} · {next ? `Due ${dateLabel(next)}` : 'Past scheduled date'}</Text>
      <Button title={`Edit payment: ${payment.name}`} secondary disabled={locked} onPress={()=>edit(payment)}/>
      <Button title={`Remove payment: ${payment.name}`} secondary disabled={locked} onPress={()=>{setRemoving(payment);setError('');setMessage('');}}/>
    </Card>)}
    <Modal visible={draft!==null || removing!==null} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{flex:1,backgroundColor:colors.bg}}><Screen>
        {draft ? <>
          <Text style={s.heading}>{app.current.profile.bills.some(payment=>payment.id===draft.id) ? 'Edit payment' : 'New payment'}</Text>
          <Field label="Payment name" placeholder="Anything you need to pay" value={draft.name} editable={!locked} onChangeText={name=>setDraft({...draft,name})}/>
          <Field label="Amount · USD" price value={draft.amount} editable={!locked} onChangeText={amount=>setDraft({...draft,amount})}/>
          <Field label="Due date · YYYY-MM-DD" placeholder="YYYY-MM-DD" value={draft.date} editable={!locked} onChangeText={date=>setDraft({...draft,date})}/>
          <Text style={s.label}>Repeat</Text>
          <View style={[s.row,{flexWrap:'wrap'}]}>{frequencies.map(item=><Pressable key={item.value} accessibilityRole="button" accessibilityState={{selected:draft.recurrence===item.value,disabled:locked}} disabled={locked} onPress={()=>setDraft({...draft,recurrence:item.value})} style={[s.chip,draft.recurrence===item.value && {backgroundColor:colors.soft,borderColor:colors.green}]}><Text style={s.label}>{item.label}</Text></Pressable>)}</View>
          {draft.recurrence==='monthly' ? <Text style={s.body}>Repeats on this day each month. Shorter months use their last day.</Text> : null}
        </> : removing ? <><Text style={s.heading}>Remove {removing.name}?</Text><Text style={s.body}>This payment will no longer be included in your forecast.</Text></> : null}
        {error ? <Text accessibilityRole="alert" style={[s.body,{color:colors.red}]}>{error}</Text> : null}
        <Button title={saving ? 'Saving…' : draft ? 'Save payment' : 'Remove payment'} disabled={locked} onPress={()=>void commit()}/>
        <Button title="Cancel" secondary disabled={saving} onPress={close}/>
      </Screen></SafeAreaView>
    </Modal>
  </Screen>;
}
