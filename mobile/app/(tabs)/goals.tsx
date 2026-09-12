import { Text, View } from "react-native";
import { router } from "expo-router";
import { Button, Card, colors, Icon, Screen, s } from "../../components/ui";
import { dateLabel, money } from "../../lib/model";
import { useApp } from "../../lib/store";
export default function Goals() {
  const {
    current: { profile, analysis, purchase },
  } = useApp();
  return (
    <Screen>
      <Text style={s.title}>Make room for{"\n"}what matters.</Text>
      <Text style={s.body}>
        Small decisions today. Bigger possibilities ahead.
      </Text>
      {profile.goals.map((goal) => {
        const progress = Math.min(
          100,
          Math.round((goal.savedCents / goal.targetCents) * 100),
        );
        const impact = analysis.today.goalImpacts.find(
          (item) => item.goalId === goal.id,
        );
        return (
          <Card key={goal.id}>
            <View style={s.between}>
              <View style={[s.chip, { padding: 16 }]}>
                <Icon name="compass" size={28} />
              </View>
              <Text style={s.eyebrow}>{progress}% saved</Text>
            </View>
            <Text style={s.title}>{goal.name}</Text>
            <Text style={s.body}>
              <Text style={s.heading}>{money(goal.savedCents)}</Text> of{" "}
              {money(goal.targetCents)}
            </Text>
            <View
              accessibilityRole="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              accessibilityLabel={`${goal.name} savings`}
              accessibilityValue={{ min: 0, max: 100, now: progress }}
              style={{
                height: 9,
                backgroundColor: colors.soft,
                borderRadius: 5,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  width: `${progress}%`,
                  height: 9,
                  backgroundColor: colors.green,
                  borderRadius: 5,
                }}
              />
            </View>
            <Text style={s.body}>
              {money(Math.max(0, goal.targetCents - goal.savedCents))} to go.
              You’re building something good.
            </Text>
            <View style={s.divider} />
            <Text style={s.label}>If you buy {purchase.productName} today</Text>
            <Text style={s.body}>
              {impact?.projectedDate
                ? `Projected goal date: ${dateLabel(impact.projectedDate, true)}${impact.delayDays !== null ? ` · ${impact.delayDays === 0 ? "No delay" : `${impact.delayDays} days later`}` : ""}`
                : "Goal completion falls outside this forecast."}
            </Text>
            <Button
              title="Explore the impact"
              secondary
              onPress={() => router.push("/future")}
            />
          </Card>
        );
      })}
      <Card tint={colors.soft}>
        <Icon name="heart" />
        <Text style={s.heading}>Your priorities are part of the plan.</Text>
        <Text style={s.body}>
          The demo protects your Japan trip savings and allows up to 14 days of
          delay. These savings are already set aside, not extra spending money.
        </Text>
      </Card>
      <Text style={[s.body, { fontSize: 12 }]}>
        Prepopulated demo goals · No bank connection required.
      </Text>
    </Screen>
  );
}
