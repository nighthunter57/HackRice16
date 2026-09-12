import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { Button, Card, colors, Icon, Screen, s } from "../components/ui";
import { dateLabel, money, verdict } from "../lib/model";
import { useApp } from "../lib/store";
export default function Result() {
  const {
    current: { analysis, purchase, profile },
    decide,
    current,
  } = useApp();
  const [saved, setSaved] = useState("");
  const state = verdict(analysis);
  const safe = state === "Safe";
  const waiting = state === "Wait";
  const tint = safe ? colors.soft : waiting ? colors.amberBg : colors.redBg;
  const color = safe ? colors.green : waiting ? colors.amber : colors.red;
  const reason = safe
    ? "You're projected to stay within your financial limits."
    : analysis.reasons[0];
  function save(choice: "Wait for it" | "Buy today" | "Skip for now") {
    decide(choice);
    setSaved(`Saved to History: ${choice.toLowerCase()}.`);
  }
  return (
    <Screen>
      <View style={{ gap: 8 }}>
        <Text style={s.eyebrow}>{purchase.category} · Purchase check</Text>
        <Text style={s.heading}>{purchase.productName}</Text>
        <Text style={s.amount}>{money(purchase.priceCents)}</Text>
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
              ? "Today"
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
      <View style={{ gap: 12 }}>
        <Text style={s.heading}>Two choices. A clearer future.</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          {[
            { label: "Buy today", data: analysis.today },
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
              <Text style={[s.heading, { fontSize: 25 }]}>
                {money(item.data.minimumBalanceCents)}
              </Text>
              <Text style={[s.body, { fontSize: 12, lineHeight: 18 }]}>
                Lowest projected cash
              </Text>
              <Text
                style={[
                  s.label,
                  {
                    color: item.data.safetyBufferViolation
                      ? colors.red
                      : colors.green,
                  },
                ]}
              >
                {item.data.safetyBufferViolation
                  ? "Below reserve"
                  : "Reserve protected"}
              </Text>
            </View>
          ))}
        </View>
        <Text style={[s.body, { fontSize: 12 }]}>
          Your safety reserve: {money(profile.safetyBufferCents)} · Next{" "}
          {profile.horizonDays} days
        </Text>
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
            ? "Save plan: buy today"
            : waiting
              ? "Save plan: wait for it"
              : "Save plan: skip for now"
        }
        icon="bookmark"
        onPress={() =>
          save(safe ? "Buy today" : waiting ? "Wait for it" : "Skip for now")
        }
      />
      {saved ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {saved}
        </Text>
      ) : null}
      <Button
        title="Check something else"
        secondary
        onPress={() => router.dismissTo("/(tabs)")}
      />
      <Text style={[s.body, { fontSize: 12 }]}>
        Demo forecast · Your choice, always. Saving a plan does not make a
        purchase.
      </Text>
      <Card>
        <Text style={s.body}>{current.explanation}</Text>
        {current.services.map(service=><Text key={service.name} style={s.body}>{service.name}: {service.mode} · {service.detail}</Text>)}
      </Card>
    </Screen>
  );
}
