import { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Field, Note, Screen, s } from '../../components/ui';
import { useApp } from '../../lib/store';
import { money, newEntryId } from '../../lib/model';
import { dollarsToCents } from '../../../src/lib/display';
import { assertDate } from '../../../src/lib/finance/dates';
import type { Bill, IncomeEvent, SavingsGoal, Recurrence } from '../../../src/types/finance';
import { FinancialStatus } from '../../components/financial-status';

type Edit = {kind:'bill'|'income'|'goal';id:string;name:string;amount:string;date:string;recurrence:Recurrence;saved:string;delay:string};
const dollars = (cents:number)=>(cents/100).toFixed(2);
export default function Settings() {
  const {current}=useApp();
  return <SettingsForm key={`${current.dataSource}:${current.profile.userId}:${current.refreshedAt??'offline'}`}/>;
}
function SettingsForm() {
  const app = useApp();
  const [draft,setDraft] = useState(app.settings);
  const [buffer,setBuffer] = useState(dollars(draft.safetyBufferCents));
  const [bills,setBills] = useState(app.current.profile.bills);
  const [income,setIncome] = useState(app.current.profile.incomeEvents);
  const [edit,setEdit] = useState<Edit|null>(null);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [saving,setSaving] = useState(false);
  const accounts = app.current.accountChoices??app.current.profile.accounts;
  const locked = saving || app.loading;
  function start(kind:Edit['kind'], item?:Bill|IncomeEvent|SavingsGoal) {
    setError('');setMessage('');
    setEdit({kind,id:item?.id??newEntryId(),name:item?.name??'',
      amount:item?dollars('targetCents' in item?item.targetCents:item.amountCents):'',
      date:item?('dueDate' in item?item.dueDate:'expectedDate' in item?item.expectedDate:item.deadline??''):kind==='goal'?'':app.current.profile.startDate,
      recurrence:item&&'recurrence' in item?item.recurrence??'once':'once',
      saved:item&&'savedCents' in item?dollars(item.savedCents):'0.00',delay:item&&'maxDelayDays' in item?String(item.maxDelayDays??0):'0'});
  }
  function finishEdit() {
    if (!edit) return;
    try {
      const amount = dollarsToCents(edit.amount);
      if (!edit.name.trim() || edit.name.trim().length>120 || amount===null) throw new Error('Enter a name and a USD amount with up to two decimal places.');
      if(edit.kind!=='goal' || edit.date) assertDate(edit.date);
      const base={id:edit.id,userId:draft.userId,name:edit.name.trim()};
      if(edit.kind==='bill') {
        const item:Bill={...base,amountCents:amount,dueDate:edit.date,recurrence:edit.recurrence,mandatory:true};
        setBills(items=>[...items.filter(i=>i.id!==item.id),item]);
        setDraft(d=>({...d,bills:[...d.bills.filter(i=>i.id!==item.id),item],excludedBillIds:d.excludedBillIds.filter(id=>id!==item.id)}));
      } else if(edit.kind==='income') {
        const item:IncomeEvent={...base,accountId:income.find(i=>i.id===edit.id)?.accountId,amountCents:amount,expectedDate:edit.date,recurrence:edit.recurrence};
        setIncome(items=>[...items.filter(i=>i.id!==item.id),item]);
        setDraft(d=>({...d,incomeEvents:[...d.incomeEvents.filter(i=>i.id!==item.id),item],excludedIncomeIds:d.excludedIncomeIds.filter(id=>id!==item.id)}));
      } else {
        const saved=dollarsToCents(edit.saved);
        if(amount<=0 || saved===null || saved>amount || !/^\d{1,3}$/.test(edit.delay)) throw new Error('Use a positive goal target, savings no higher than the target, and an allowed delay of 0–366 days.');
        const delay=Number(edit.delay);
        if(delay>366) throw new Error('Allowed delay must be 0–366 days.');
        const item:SavingsGoal={...base,targetCents:amount,savedCents:saved,maxDelayDays:delay,...(edit.date?{deadline:edit.date}:{})};
        setDraft(d=>({...d,goals:d.goals.some(i=>i.id===item.id)?d.goals.map(i=>i.id===item.id?item:i):[...d.goals,item]}));
      }
      setEdit(null);setError('');setMessage('Change added. Save setup to update your forecast.');
    } catch(cause) {setError(cause instanceof Error?cause.message:'Check the fields and try again.');}
  }
  async function save() {
    setError('');setMessage('');setSaving(true);
    try {
      const cents=dollarsToCents(buffer);
      if(cents===null) throw new Error('Enter a valid safety buffer in USD.');
      await app.saveSettings({...draft,safetyBufferCents:cents});
      setMessage('Setup saved. Your purchase result, Safe Date, and goal impacts are updated.');
    } catch(cause) {setError(cause instanceof Error?cause.message:'Setup could not be saved on this device.');}
    finally {setSaving(false);}
  }
  return <Screen>
    <Text style={s.title}>Your financial plan.</Text>
    <Text style={s.body}>Choose your spending accounts, bills, and savings goals.</Text>
    <FinancialStatus/>
    <Card>
      <Text style={s.heading}>Spendable accounts</Text>
      {accounts.map(account=><Button key={account.id} secondary disabled={locked} title={`${draft.accountIds.includes(account.id)?'Included':'Excluded'}: ${account.name} · ${money(account.balanceCents)}`}
        onPress={()=>setDraft(d=>({...d,accountIds:d.accountIds.includes(account.id)?d.accountIds.filter(id=>id!==account.id):[...d.accountIds,account.id]}))} />)}
      <Text style={s.body}>Bills and expected income apply to this combined spending pool. Savings marked for goals are reserved within the selected accounts.</Text>
      <Field label="Safety buffer · USD" value={buffer} onChangeText={setBuffer} price editable={!locked}/>
    </Card>
    <Modal visible={!!edit} animationType="slide" onRequestClose={()=>{setEdit(null);setError('');}}>
    {edit ? <SafeAreaView style={{flex:1}}><Screen><Card>
      <Text style={s.heading}>Edit {edit.kind}</Text>
      <Field label="Name" value={edit.name} onChangeText={name=>setEdit({...edit,name})}/>
      <Field label={edit.kind==='goal'?'Target · USD':'Amount · USD'} value={edit.amount} price onChangeText={amount=>setEdit({...edit,amount})}/>
      <Field label={edit.kind==='goal'?'Deadline · YYYY-MM-DD (optional)':'Date · YYYY-MM-DD'} value={edit.date} onChangeText={date=>setEdit({...edit,date})}/>
      {edit.kind==='goal'?<>
        <Field label="Already saved · USD" value={edit.saved} price onChangeText={saved=>setEdit({...edit,saved})}/>
        <Field label="Allowed delay · days" value={edit.delay} onChangeText={delay=>setEdit({...edit,delay})}/>
      </>:<View style={{gap:8}}>{(['once','weekly','biweekly','monthly'] as const).map(recurrence=><Button key={recurrence} secondary title={`${edit.recurrence===recurrence?'Selected: ':''}${recurrence}`} onPress={()=>setEdit({...edit,recurrence})}/>)}</View>}
      {error?<Note>{error}</Note>:null}
      <Button title="Apply entry" onPress={finishEdit}/><Button title="Cancel edit" secondary onPress={()=>{setEdit(null);setError('');}}/>
    </Card></Screen></SafeAreaView>:null}
    </Modal>
    <Card>
      <Text style={s.heading}>Upcoming bills</Text>
      {!bills.length && <Text style={s.body}>No bills added yet.</Text>}
      {bills.map(item=><View key={item.id} style={{gap:8}}>
        <Text style={s.label}>{item.name} · {money(item.amountCents)} · {item.dueDate} · {item.recurrence}</Text>
        <Button title={`Edit bill: ${item.name}`} secondary disabled={locked} onPress={()=>start('bill',item)}/>
        <Button title={`Remove bill: ${item.name}`} secondary disabled={locked} onPress={()=>{setBills(items=>items.filter(i=>i.id!==item.id));setDraft(d=>({...d,excludedBillIds:[...new Set([...d.excludedBillIds,item.id])]}));}}/>
      </View>)}
      <Button title="Add bill" secondary disabled={locked} onPress={()=>start('bill')}/>
    </Card>
    <Card>
      <Text style={s.heading}>Expected income</Text>
      {!income.length && <Text style={s.body}>No income scheduled.</Text>}
      {income.map(item=><View key={item.id} style={{gap:8}}>
        <Text style={s.label}>{item.name??'Income'} · {money(item.amountCents)} · {item.expectedDate} · {item.recurrence??'once'}</Text>
        <Button title={`Edit income: ${item.name??'Income'}`} secondary disabled={locked} onPress={()=>start('income',item)}/>
        <Button title={`Remove income: ${item.name??'Income'}`} secondary disabled={locked} onPress={()=>{setIncome(items=>items.filter(i=>i.id!==item.id));setDraft(d=>({...d,excludedIncomeIds:[...new Set([...d.excludedIncomeIds,item.id])]}));}}/>
      </View>)}
      <Button title="Add income" secondary disabled={locked} onPress={()=>start('income')}/>
    </Card>
    <Card>
      <Text style={s.heading}>Savings goals</Text>
      <Text style={s.body}>Goals receive available savings in this order. Move your most important goal first.</Text>
      {draft.goals.map((item,index)=><View key={item.id} style={{gap:8}}>
        <Text style={s.label}>{index+1}. {item.name} · {money(item.savedCents)} / {money(item.targetCents)}</Text>
        <Button title={`Edit goal: ${item.name}`} secondary disabled={locked} onPress={()=>start('goal',item)}/>
        <Button title={`Prioritize: ${item.name}`} secondary disabled={locked || index===0} onPress={()=>setDraft(d=>({...d,goals:[item,...d.goals.filter(i=>i.id!==item.id)]}))}/>
        <Button title={`Remove goal: ${item.name}`} secondary disabled={locked} onPress={()=>setDraft(d=>({...d,goals:d.goals.filter(i=>i.id!==item.id)}))}/>
      </View>)}
      <Button title="Add goal" secondary disabled={locked} onPress={()=>start('goal')}/>
    </Card>
    {error && !edit?<Note>{error}</Note>:null}
    {message?<Text accessibilityLiveRegion="polite" style={s.body}>{message}</Text>:null}
    <Button title={saving?'Saving setup…':'Save setup & update forecast'} disabled={locked || !!edit} onPress={()=>void save()}/>
  </Screen>;
}
