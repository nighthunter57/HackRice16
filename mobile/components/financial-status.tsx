import { Text } from 'react-native';
import { Button, Card, s } from './ui';
import { useApp } from '../lib/store';

export function FinancialStatus() {
  const {current,savedSnapshot,refresh,refreshError,loading,ready} = useApp();
  return <Card>
    <Text style={s.label}>{current.dataSource==='demo'?'Sample finances':savedSnapshot?'Saved result':'Account balances'}</Text>
    {current.refreshedAt && <Text style={s.body}>Updated {new Date(current.refreshedAt).toLocaleString()}</Text>}
    {refreshError?<Text accessibilityLiveRegion="polite" style={s.body}>{refreshError}</Text>:null}
    <Button title={loading?'Refreshing finances…':'Refresh finances'} secondary disabled={loading||!ready} onPress={()=>void refresh()}/>
  </Card>;
}
