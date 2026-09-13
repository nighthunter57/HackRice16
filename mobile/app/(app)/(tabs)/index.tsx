import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Card,
  colors,
  Icon,
  PurchaseForm,
  Screen,
  s,
} from "../../../components/ui";
import { dateLabel, money } from "../../../lib/model";
import { useApp } from "../../../lib/store";
import { FinancialStatus } from '../../../components/financial-status';
export default function Home() {
  const { current, history, open, loading } = useApp();
  const [suggestion, setSuggestion] = useState("449");
  const bill = current.analysis.baseline.days.flatMap(day=>day.events.filter(event=>event.type==='bill').map(event=>({name:event.name,dueDate:day.date,amountCents:-event.amountCents})))[0];
  return (
    <Screen>
      <View style={{ gap: 12 }}>
        <View style={s.row}>
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: colors.green,
            }}
          />
          <Text style={s.eyebrow}>A little clarity before checkout</Text>
        </View>
        <Text style={s.title}>See your financial future before you spend.</Text>
        <Text style={s.body}>
          Something caught your eye? Let’s see how it fits.
        </Text>
      </View>
      <Button
        title="Scan Something"
        icon="camera"
        onPress={() => router.push("/scan")}
      />
      <Button title="Financial setup" secondary onPress={()=>router.push('/settings')} disabled={loading}/>
      <Button title="Payments" icon="calendar" secondary onPress={()=>router.push('/payments')} disabled={loading}/>
      <FinancialStatus/>
      <View style={s.row}>
        <View style={[s.divider, { flex: 1 }]} />
        <Text style={s.body}>or enter it manually</Text>
        <View style={[s.divider, { flex: 1 }]} />
      </View>
      <Card>
        <Text style={s.heading}>What are you thinking{"\n"}about buying?</Text>
        <PurchaseForm
          key={suggestion}
          initialName="Sony Headphones"
          initialPrice={suggestion}
        />
        <View style={[s.row, { flexWrap: "wrap" }]}>
          {["100", "300", "500"].map((price) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: loading }}
              disabled={loading}
              key={price}
              onPress={() => setSuggestion(price)}
              style={s.chip}
            >
              <Text style={s.label}>Try ${price}</Text>
            </Pressable>
          ))}
        </View>
      </Card>
      <Card tint={colors.soft}>
        <Text style={s.eyebrow}>Your spending plan</Text>
        <Text style={s.label}>Available checking: {money(current.profile.accounts.filter(a=>a.type==='checking').reduce((total,a)=>total+a.balanceCents,0))}</Text>
        <View style={s.between}>
          <Text style={s.label}>Safe to spend today</Text>
          <Icon name="shield" />
        </View>
        <Text style={s.amount}>{money(current.analysis.safeMaximumCents)}</Text>
        <Text style={s.body}>
          Based on upcoming expenses, your goals, and your safety reserve.
        </Text>
        {bill && (
          <>
            <View style={s.divider} />
            <Text style={s.eyebrow}>Next payment</Text>
            <Text style={s.label}>
              {bill.name} · {dateLabel(bill.dueDate)} ·{" "}
              {money(bill.amountCents)}
            </Text>
          </>
        )}
      </Card>
      {history[0] && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            open(history[0]);
            router.push("/result");
          }}
        >
          <Card>
            <Text style={s.eyebrow}>Recently checked</Text>
            <View style={s.between}>
              <View style={{ flex: 1 }}>
                <Text style={s.heading}>{history[0].purchase.productName}</Text>
                <Text style={s.body}>
                  {money(history[0].purchase.priceCents)}
                </Text>
              </View>
              <Icon name="arrow-up-right" />
            </View>
          </Card>
        </Pressable>
      )}

    </Screen>
  );
}
