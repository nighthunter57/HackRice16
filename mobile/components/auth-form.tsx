import { Brand } from './brand';
import { useState } from 'react';
import { Text,TextInput,View } from 'react-native';
import { Link,useLocalSearchParams } from 'expo-router';
import { Button,Note,Screen,s } from './ui';
import { useAuth } from '../../src/lib/auth/auth-context';
import { emailSchema,passwordSchema,nameSchema } from '../../src/types/auth';
export function AuthField({label,value,onChange,password=false,email=false,disabled=false}:{label:string;value:string;onChange:(text:string)=>void;password?:boolean;email?:boolean;disabled?:boolean}){
  const [visible,setVisible]=useState(false);
  return <View style={{gap:8}}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled} secureTextEntry={password&&!visible} autoCapitalize="none" autoCorrect={false} keyboardType={email?'email-address':'default'} autoComplete={email?'email':password?'password':'off'} maxLength={email?254:password?128:100} style={s.input}/>{password&&<Button title={`${visible?'Hide':'Show'} ${label.toLowerCase()}`} secondary disabled={disabled} onPress={()=>setVisible(!visible)}/>}</View>;
}
export function AuthForm({mode}:{mode:'login'|'register'|'forgot'|'reset'}){
  const auth=useAuth();const params=useLocalSearchParams<{token?:string}>();
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
  const [token,setToken]=useState(typeof params.token==='string'?params.token:'');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const title={login:'Welcome back',register:'Create your account',forgot:'Forgot your password?',reset:'Reset Password'}[mode];
  async function submit(){
    if(busy)return;setError('');setBusy(true);
    try{
      if(mode==='register'||mode==='reset') {if(!passwordSchema.safeParse(password).success)throw new Error('Use a password with 10–128 characters.');if(password!==confirm)throw new Error('Passwords do not match.');}
      if(mode==='register'&&!nameSchema.safeParse(name).success)throw new Error('Enter your name.');
      if(mode!=='reset'&&!emailSchema.safeParse(email).success)throw new Error('Enter a valid email address.');
      if(mode==='register')await auth.register(name.trim(),email.trim().toLowerCase(),password);
      if(mode==='login')await auth.login(email.trim().toLowerCase(),password);
      if(mode==='forgot'){await auth.forgotPassword(email.trim().toLowerCase());setSuccess('If an account exists for this email, reset instructions have been sent.');}
      if(mode==='reset'){await auth.resetPassword(token,password);setSuccess('Password updated.');setPassword('');setConfirm('');setToken('');}
    }catch(cause){setError(cause instanceof Error?cause.message:'Please try again.');}finally{setBusy(false);}
  }
  return <Screen><Brand large/><Text style={s.title}>{title}</Text>
    {mode==='forgot'&&<Text style={s.body}>Enter your email and we’ll send reset instructions.</Text>}
    {!success&&<>
      {mode==='register'&&<AuthField label="Name" value={name} onChange={setName} disabled={busy}/>}
      {mode!=='reset'&&<AuthField label="Email" value={email} onChange={setEmail} email disabled={busy}/>}
      {mode==='reset'&&!params.token&&<AuthField label="Reset token" value={token} onChange={setToken} disabled={busy}/>}
      {mode!=='forgot'&&<AuthField label={mode==='reset'?'New Password':'Password'} value={password} onChange={setPassword} password disabled={busy}/>}
      {(mode==='register'||mode==='reset')&&<AuthField label="Confirm Password" value={confirm} onChange={setConfirm} password disabled={busy}/>}
      {error?<Note>{error}</Note>:null}
      <Button title={busy?'Please wait…':{login:'Sign In',register:'Create Account',forgot:'Send Reset Link',reset:'Reset Password'}[mode]} disabled={busy} onPress={()=>void submit()}/>
    </>}
    {success?<Text accessibilityLiveRegion="polite" style={s.body}>{success}</Text>:null}
    {mode==='forgot'&&<Link href="/(auth)/reset-password" style={s.label}>Enter a reset code</Link>}
    {mode==='login'?<><Link href="/(auth)/forgot-password" style={s.label}>Forgot password?</Link><Text style={s.body}>Don’t have an account?</Text><Link href="/(auth)/sign-up" style={s.label}>Create account</Link></>:<Link href="/(auth)/sign-in" style={s.label}>{mode==='register'?'Already have an account? Sign In':'Back to Sign In'}</Link>}
  </Screen>;
}
