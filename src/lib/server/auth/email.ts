/** One delivery boundary. Reset credentials may be logged only in explicit development mode. */
export async function sendPasswordResetEmail(email:string,resetToken:string) {
  const base=process.env.PASSWORD_RESET_URL??'spendly://reset-password';
  const url=new URL(base);url.searchParams.set('token',resetToken);
  if(process.env.EMAIL_PROVIDER==='resend') {
    if(!process.env.EMAIL_API_KEY || !process.env.EMAIL_FROM || process.env.NODE_ENV==='production' && url.protocol!=='https:') throw new Error('Email is not configured.');
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.EMAIL_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:process.env.EMAIL_FROM,to:[email],subject:'Reset your Spendly password',text:`Reset your password: ${url.toString()}\nThis link expires shortly. If you did not request it, you can ignore this message.`}),signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error('Email delivery failed.');
    return;
  }
  if(process.env.NODE_ENV==='development') {console.info('[auth.reset.development]',url.toString());return;}
  throw new Error('Password-reset email is not configured.');
}
export function resetDeliveryAvailable(){return process.env.NODE_ENV==='development' || process.env.EMAIL_PROVIDER==='resend' && !!process.env.EMAIL_API_KEY && !!process.env.EMAIL_FROM && !!process.env.PASSWORD_RESET_URL;}
