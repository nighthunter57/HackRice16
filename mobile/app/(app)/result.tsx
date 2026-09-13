import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { Button, Card, colors, Icon, Screen, s } from "../../components/ui";
import { dateLabel, verdict } from "../../lib/model";
import { useApp } from "../../lib/store";
import { BalanceImpactDetails } from '../../components/balance-impact';
import { balanceImpactExplanation } from '../../../src/lib/balance-impact';
import { formatMoney } from '../../../src/lib/finance/money';
import { whyWait } from '../../../src/lib/finance/why-wait';
import { FinancialStatus } from '../../components/financial-status';
export default function Result() {
  const {
    current: { analysis, purchase, profile },
    decide,
    current,
    savedSnapshot,
    savedSourceKnown,
    loading,
  } = useApp();
  const [saved, setSaved] = useState<{profile:typeof profile;text:string}|null>(null);
  const historical = savedSnapshot || profile.startDate !== new Date().toISOString().slice(0, 10);
  const sourceLabel = savedSnapshot && !savedSourceKnown ? 'Saved result' : current.dataSource === 'demo' ? 'Sample finances' : 'Your forecast';
  const state = verdict(analysis);
  const safe = state === "Safe";
  const waiting = state === "Wait";
  const evidence = whyWait(analysis);
  const tint = safe ? colors.soft : waiting ? colors.amberBg : colors.redBg;
  const color = safe ? colors.green : waiting ? colors.amber : colors.red;
  const reason = safe
    ? "You're projected to stay within your financial limits."
    : analysis.reasons[0];
  function save(choice: "Wait for it" | "Buy today" | "Skip for now") {
    decide(choice);
    setSaved({profile,text:`Saved to History: ${choice.toLowerCase()}.`});
  }
  return (
    <Screen>
      <View style={{ gap: 8 }}>
        <Text style={s.eyebrow}>Purchase check</Text>
        <Text style={s.heading}>{purchase.productName}</Text>
        <Text style={s.amount}>{formatMoney(purchase.priceCents)}</Text>
        <Text style={s.body}>{sourceLabel} · {dateLabel(profile.startDate, true)}</Text>
      </View>
      <Card tint={tint}>
        <View style={s.row}>
          <Icon
            name={safe ? "check-circle" : waiting ? "clock" : "shield"}
            color={color}
            size={30}
          />
          <Text
            accessibilityRole="header"
            style={[s.title, { color, fontSize: 40 }]}
          >
            {state}
          </Text>
        </View>
        <Text style={[s.heading, { color }]}>
          {safe
            ? "Room for this, and what matters."
            : waiting
              ? `Wait ${analysis.waitDays} ${analysis.waitDays === 1 ? "day" : "days"}`
              : "Give your future a little more room."}
        </Text>
        <BalanceImpactDetails impact={analysis.today.balanceImpact} />
        <Text style={s.body}>{balanceImpactExplanation(analysis.today.balanceImpact)}</Text>
        <View
          style={{
            backgroundColor: "#FFFFFFB8",
            borderRadius: 18,
            padding: 20,
            gap: 8,
          }}
        >
          <Text style={s.eyebrow}>Earliest Safe Date</Text>
          <Text style={[s.title, { fontSize: 29 }]}>
            {safe
              ? historical ? dateLabel(profile.startDate, true) : "Today"
              : analysis.safeDate
                ? dateLabel(analysis.safeDate, true)
                : "Beyond this forecast"}
          </Text>
          <Text style={s.body}>
            {safe
              ? dateLabel(profile.startDate, true)
              : analysis.safeDate
                ? "Bills covered. Safety reserve protected."
                : `No safe date found in the next ${profile.horizonDays} days.`}
          </Text>
        </View>
        <Text style={[s.body, { color }]}>{reason}</Text>
      </Card>
      <Card>
        <Text style={s.heading}>{safe?'Why this fits':'Why wait?'}</Text>
        <Text style={s.body}>{evidence.explanation}</Text>
        {evidence.bills.length>0 && <Text style={s.label}>Bills due before the first reserve shortfall</Text>}
        {evidence.bills.map(bill=><Text key={bill.id} style={s.body}>{bill.name} · {dateLabel(bill.date,true)} · {formatMoney(bill.amountCents)}</Text>)}
      </Card>
      <View style={{ gap: 12 }}>
        <Text style={s.heading}>Two choices. A clearer future.</Text>
        <View style={{ gap: 12 }}>
          {[
            { label: historical ? `Buy on ${dateLabel(profile.startDate)}` : "Buy today", data: analysis.today },
            {
              label: analysis.wait ? "Wait until safe" : "Keep your money",
              data: analysis.wait ?? analysis.baseline,
            },
          ].map((item) => (
            <View
              key={item.label}
              style={{
                flex: 1,
                backgroundColor: "#fff",
                borderRadius: 20,
                padding: 17,
                gap: 10,
              }}
            >
              <Text style={s.label}>{item.label}</Text>
              <BalanceImpactDetails impact={item.data.balanceImpact} />
              {item.data.proposedPurchaseDate && <Text style={s.body}>Purchase date: {dateLabel(item.data.proposedPurchaseDate, true)}</Text>}
            </View>
          ))}
        </View>

      </View>
      <Button
        title="Explore my FutureMe"
        secondary
        icon="trending-up"
        onPress={() => router.push("/future")}
      />
      <Button
        title={
          safe
            ? historical ? "Save purchase plan" : "Save plan: buy today"
            : waiting
              ? "Save plan: wait for it"
              : "Save plan: skip for now"
        }
        icon="bookmark"
        disabled={loading}
        onPress={() =>
          save(safe ? "Buy today" : waiting ? "Wait for it" : "Skip for now")
        }
      />
      {saved?.profile === profile ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {saved.text}
        </Text>
      ) : null}
      <Button
        title="Check something else"
        secondary
        onPress={() => router.dismissTo("/(app)/(tabs)")}
      />
      <FinancialStatus/>

    </Screen>
  );
}
