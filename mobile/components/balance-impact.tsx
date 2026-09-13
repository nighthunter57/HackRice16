import { Text, View } from 'react-native';
import type { BalanceImpact } from '../../src/types/finance';
import { balanceImpactRows } from '../../src/lib/balance-impact';
import { s } from './ui';

export function BalanceImpactDetails({ impact }: { impact: BalanceImpact }) {
  return <View style={{ gap: 12 }}>
    {balanceImpactRows(impact).map(row => <View key={row.label} style={[s.between, { flexWrap: 'wrap', gap: 8 }]}>
      <Text style={s.body}>{row.label}</Text>
      <Text style={s.heading}>{row.value}</Text>
    </View>)}
  </View>;
}
