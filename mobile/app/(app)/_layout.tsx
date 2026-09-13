import { Stack } from 'expo-router';
import { AppProvider } from '../../lib/store';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { colors } from '../../components/ui';
export default function AppLayout(){
  const {user}=useAuth();
  if(!user)return null;
  return <AppProvider key={user.id}><Stack screenOptions={{headerStyle:{backgroundColor:colors.bg},headerTintColor:colors.ink,headerShadowVisible:false,headerBackButtonDisplayMode:'minimal',contentStyle:{backgroundColor:colors.bg}}}>
    <Stack.Screen name="index" options={{headerShown:false}}/>
    <Stack.Screen name="(tabs)" options={{headerShown:false}}/>
    <Stack.Screen name="scan" options={{title:'Scan a Product'}}/>
    <Stack.Screen name="result" options={{title:'Your purchase'}}/>
    <Stack.Screen name="future" options={{title:'FutureMe'}}/>
    <Stack.Screen name="settings" options={{title:'Financial setup'}}/>
    <Stack.Screen name="payments" options={{title:'Payments'}}/>
  </Stack></AppProvider>;
}
