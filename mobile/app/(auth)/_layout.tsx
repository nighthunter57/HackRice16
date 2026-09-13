import { Stack } from 'expo-router';
import { colors } from '../../components/ui';
export default function AuthLayout(){return <Stack initialRouteName="sign-in" screenOptions={{headerShown:false,contentStyle:{backgroundColor:colors.bg}}}/>;}
