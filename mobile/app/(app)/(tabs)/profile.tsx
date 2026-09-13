import { useState } from 'react';
import { Modal,Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../../src/lib/auth/auth-context';
import { AuthField } from '../../../components/auth-form';
import { Button,Card,Note,Screen,s } from '../../../components/ui';
import { passwordSchema } from '../../../../src/types/auth';
export default function Profile(){
  const auth=useAuth();
  const [name,setName]=useState(auth.user?.name??'');
  const [editing,setEditing]=useState(false),[deleting,setDeleting]=useState(false);
  const [current,setCurrent]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[deletion,setDeletion]=useState('');
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setMessage('');try{await action();}catch(cause){setError(cause instanceof Error?cause.message:'Please try again.');}finally{setBusy(false);}}
  return <Screen><Text style={s.title}>Profile</Text><Card>
    <AuthField label="Name" value={name} onChange={setName} disabled={busy}/><Text style={s.body}>{auth.user?.email}</Text>
    <Button title="Save name" secondary disabled={busy} onPress={()=>void run(async()=>{await auth.updateProfile(name.trim());setMessage('Profile updated.');})}/>
  </Card><Card><Text style={s.heading}>Account</Text>
    <Button title="Change Password" secondary disabled={busy} onPress={()=>{setEditing(!editing);setError('');}}/>
    {editing&&<>
      <AuthField label="Current Password" value={current} onChange={setCurrent} password disabled={busy}/>
      <AuthField label="New Password" value={password} onChange={setPassword} password disabled={busy}/>
      <AuthField label="Confirm Password" value={confirm} onChange={setConfirm} password disabled={busy}/>
      <Button title="Update password" disabled={busy} onPress={()=>void run(async()=>{
        if(!passwordSchema.safeParse(password).success)throw new Error('Use a password with 10–128 characters.');
        if(password!==confirm)throw new Error('Passwords do not match.');
        await auth.changePassword(current,password);setCurrent('');setPassword('');setConfirm('');setEditing(false);setMessage('Password updated. Other sessions have been signed out.');
      })}/>
    </>}
    <Button title="Sign Out" disabled={busy} onPress={()=>void run(auth.logout)}/>
  </Card>
  {!deleting&&error&&<Note>{error}</Note>}{message&&<Text accessibilityLiveRegion="polite" style={s.body}>{message}</Text>}
  <Card><Text style={s.heading}>Danger Zone</Text><Button title="Delete Account" secondary disabled={busy} onPress={()=>{setDeleting(true);setError('');setDeletion('');}}/></Card>
  <Modal visible={deleting} onRequestClose={()=>{if(!busy)setDeleting(false);}} animationType="slide">
    <SafeAreaView style={{flex:1}}><Screen><Text style={s.title}>Delete your account?</Text>
      <Text style={s.body}>This permanently removes your Spendly account and app data.</Text>
      <AuthField label="Type DELETE to confirm" value={deletion} onChange={setDeletion} disabled={busy}/>
      {error&&<Note>{error}</Note>}
      <Button title={busy?'Deleting account…':'Permanently delete account'} disabled={busy||deletion!=='DELETE'} onPress={()=>void run(auth.deleteAccount)}/>
      <Button title="Cancel" secondary disabled={busy} onPress={()=>setDeleting(false)}/>
    </Screen></SafeAreaView>
  </Modal></Screen>;
}
