import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {resolveBackendUrl} from './backend-url';

export const apiUrl=resolveBackendUrl({configured:process.env.EXPO_PUBLIC_API_URL,expoHost:Constants.expoConfig?.hostUri,platform:Platform.OS,webHostname:Platform.OS==='web' && typeof window!=='undefined'?window.location.hostname:undefined});
