import { Stack } from 'expo-router';
import { ActivityIndicator,Text,View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider,useAuth } from '../../src/lib/auth/auth-context';
import { Button,colors,s } from '../components/ui';
function Routes(){
  const auth=useAuth();
  if(auth.isLoading)return <View style={{flex:1,justifyContent:'center',alignItems:'center',backgroundColor:colors.bg}}><ActivityIndicator/><Text style={s.body}>Restoring your session…</Text></View>;
  if(auth.startupError)return <View style={[s.screen,{flex:1,justifyContent:'center'}]}><Text style={s.body}>{auth.startupError}</Text><Button title="Retry connection" onPress={()=>void auth.restore()}/></View>;
  return <><StatusBar style="dark"/><Stack screenOptions={{headerShown:false}}>
    <Stack.Protected guard={!auth.isAuthenticated}><Stack.Screen name="(auth)"/></Stack.Protected>
    <Stack.Protected guard={auth.isAuthenticated}><Stack.Screen name="(app)"/></Stack.Protected>
  </Stack></>;
}
export default function Root(){return <AuthProvider><Routes/></AuthProvider>;}
