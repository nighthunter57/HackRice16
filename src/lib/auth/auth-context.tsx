import { createContext,useContext,useEffect,useRef,useState,type ReactNode } from 'react';
import { Platform } from 'react-native';
import {removeUserData} from '../../../mobile/lib/user-storage';
import { userSchema,type AuthUser } from '../../types/auth';
import { apiUrl } from '../../../mobile/lib/endpoint';
import { authRequest,sessionSchema,createAuthenticatedFetch,errorResponse,ApiError,type Session } from './auth-api';
import { readTokens,storeTokens,clearTokens } from './auth-storage';

function useAuthState() {
  const [user,setUser]=useState<AuthUser|null>(null);
  const [isLoading,setLoading]=useState(true);
  const [startupError,setStartupError]=useState('');
  const tokens=useRef<{accessToken:string;refreshToken?:string}|null>(null);
  const refreshInFlight=useRef<Promise<string>|null>(null);
  const generation=useRef(0);
  async function clearSession(){generation.current++;tokens.current=null;setUser(null);await clearTokens();}
  async function accept(session:Session,version=generation.current) {
    if(version!==generation.current)throw new ApiError(401,'Please sign in again.');
    await storeTokens({accessToken:session.accessToken,refreshToken:session.refreshToken??''});
    if(version!==generation.current)throw new ApiError(401,'Please sign in again.');
    tokens.current={accessToken:session.accessToken,refreshToken:session.refreshToken};setUser(session.user);setStartupError('');
  }
  async function refreshSession():Promise<string> {
    if(refreshInFlight.current)return refreshInFlight.current;
    const version=generation.current;
    const operation=(async()=>{
      const session=sessionSchema.parse(await authRequest('/api/auth/refresh',tokens.current?.refreshToken?{refreshToken:tokens.current.refreshToken}:{}));
      if(version!==generation.current)throw new ApiError(401,'Please sign in again.');
      await accept(session,version);return session.accessToken;
    })();
    refreshInFlight.current=operation;
    try{return await operation;}finally{if(refreshInFlight.current===operation)refreshInFlight.current=null;}
  }
  const apiFetch:typeof fetch=(input,init)=>createAuthenticatedFetch(()=>tokens.current?.accessToken,refreshSession,clearSession)(input,init);
  async function restore() {
    setLoading(true);setStartupError('');
    try {
      const stored=await readTokens();tokens.current=stored;
      if(!stored && Platform.OS!=='web')return;
      const access=await refreshSession();
      setUser(userSchema.parse(await authRequest('/api/me',undefined,'GET',access)));
    } catch(error) {
      if(error instanceof ApiError && error.status===0){setUser(null);setStartupError(error.message);}
      else await clearSession();
    } finally{setLoading(false);}
  }
  const restoreRef=useRef(restore);
  useEffect(()=>{void restoreRef.current();},[]);
  async function register(name:string,email:string,password:string){const version=++generation.current;await accept(sessionSchema.parse(await authRequest('/api/auth/register',{name,email,password})),version);}
  async function login(email:string,password:string){const version=++generation.current;await accept(sessionSchema.parse(await authRequest('/api/auth/login',{email,password})),version);}
  async function protectedRequest(path:string,body?:unknown,method='POST') {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),30000);
    let response:Response;
    try{response=await apiFetch(`${apiUrl.replace(/\/$/,'')}${path}`,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});}
    catch(error){if(error instanceof ApiError)throw error;throw new ApiError(0,'Cannot reach the server. Please try again.');}
    finally{clearTimeout(timer);}
    if(!response.ok)throw await errorResponse(response);const result:unknown=await response.json();return result;
  }
  async function logout(){const version=generation.current;await protectedRequest('/api/auth/logout',{});if(version===generation.current)await clearSession();}
  async function changePassword(currentPassword:string,newPassword:string){const version=generation.current;await accept(sessionSchema.parse(await protectedRequest('/api/auth/change-password',{currentPassword,newPassword})),version);}
  async function deleteAccount(){const id=user?.id,version=generation.current;await protectedRequest('/api/me',{confirmation:'DELETE'},'DELETE');if(version===generation.current)await clearSession();if(id)await removeUserData(id);}
  async function updateProfile(name:string){const version=generation.current;const updated=userSchema.parse(await protectedRequest('/api/me',{name},'PATCH'));if(version===generation.current)setUser(updated);}
  return {user,isAuthenticated:!!user,isLoading,startupError,restore,register,login,logout,refreshSession,apiFetch,
    forgotPassword:(email:string)=>authRequest('/api/auth/forgot-password',{email}),
    resetPassword:(token:string,newPassword:string)=>authRequest('/api/auth/reset-password',{token,newPassword}),changePassword,deleteAccount,updateProfile};
}
const AuthContext=createContext<ReturnType<typeof useAuthState>|null>(null);
export function AuthProvider({children}:{children:ReactNode}){const value=useAuthState();return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;}
export function useAuth(){const auth=useContext(AuthContext);if(!auth)throw new Error('AuthProvider is required');return auth;}
