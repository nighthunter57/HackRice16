import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, colors, Icon, Screen, s } from "../components/ui";
import { dateLabel, money } from "../lib/model";
import { useApp } from "../lib/store";
export default function Future() {
  const {
    current: { analysis, profile, purchase },
    check,
    repair,
    ready,
    loading,
    current,
  } = useApp();
  const [choice, setChoice] = useState<"today" | "wait">("today");
  const [change, setChange] = useState("");
  const scenario =
    choice === "today" ? analysis.today : (analysis.wait ?? analysis.baseline);
  const [dayIndex, setDayIndex] = useState(0);
  const selected = scenario.days[dayIndex];
  const samples = scenario.days.filter((_, index) => index % 3 === 0);
  const balances = [
    ...analysis.today.days,
    ...(analysis.wait ?? analysis.baseline).days,
  ].map((day) => day.closingBalanceCents);
  const maximum = Math.max(profile.safetyBufferCents, ...balances, 1);
  const minimum = Math.min(0, ...balances);
  const range = maximum - minimum;
  async function toggleRepair() {
    const previous = analysis.safeDate;
    await check(purchase, !repair);
    setChange(
      `${repair ? "Removed" : "Added"} a $430 car repair due September 20. Previous Safe Date: ${previous ? dateLabel(previous) : "outside forecast"}.`,
    );
  }
  return (
    <Screen>
      <View style={s.row}>
        <Icon name="trending-up" />
        <Text style={s.eyebrow}>A look ahead, not a leap of faith</Text>
      </View>
      <Text style={s.title}>Meet your{"\n"}future choices.</Text>
      <Text style={s.body}>
        See how {purchase.productName} fits around everyday life.
      </Text>
      <View
        accessibilityRole="tablist"
        style={[
          s.row,
          { backgroundColor: colors.soft, padding: 5, borderRadius: 18 },
        ]}
      >
        {(["today", "wait"] as const).map((value) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: choice === value }}
            key={value}
            onPress={() => setChoice(value)}
            style={{
              flex: 1,
              minHeight: 48,
              borderRadius: 14,
              padding: 12,
              backgroundColor: choice === value ? "#fff" : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={s.label}>
              {value === "today"
                ? "Buy today"
                : analysis.wait
                  ? "Wait until safe"
                  : "No purchase"}
            </Text>
          </Pressable>
        ))}
      </View>
      <Card>
        <Text style={s.eyebrow}>
          Projected cash · {profile.horizonDays} days
        </Text>
        <Text style={s.heading}>
          {choice === "today"
            ? "If you buy today"
            : analysis.wait
              ? "If you wait until safe"
              : "If you keep your money"}
        </Text>
        <View
          style={{
            height: 145,
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 4,
          }}
        >
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${(maximum / range) * 100}%`,
              height: 1,
              backgroundColor: colors.line,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${((maximum - profile.safetyBufferCents) / range) * 100}%`,
              borderTopWidth: 1,
              borderStyle: "dashed",
              borderColor: colors.amber,
            }}
          />
          {samples.map((day) => (
            <Pressable
              key={day.date}
              accessibilityRole="button"
              accessibilityLabel={`${dateLabel(day.date)}, ${money(day.closingBalanceCents)}${day.safetyBufferViolation ? ", below safety reserve" : ""}`}
              onPress={() => setDayIndex(scenario.days.indexOf(day))}
              style={{ flex: 1, height: "100%", justifyContent: "flex-end" }}
            >
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: `${((maximum - Math.max(day.closingBalanceCents, 0)) / range) * 100}%`,
                  height: `${(Math.abs(day.closingBalanceCents) / range) * 100}%`,
                  backgroundColor: day.safetyBufferViolation
                    ? colors.red
                    : colors.green,
                  opacity: selected.date === day.date ? 1 : 0.6,
                  borderTopLeftRadius: 4,
                  borderTopRightRadius: 4,
                }}
              />
            </Pressable>
          ))}
        </View>
        <View style={s.between}>
          <Text style={s.body}>{dateLabel(scenario.days[0].date)}</Text>
          <Text style={s.body}>
            {dateLabel(scenario.days[scenario.days.length - 1].date)}
          </Text>
        </View>
        <Text style={[s.body, { fontSize: 12 }]}>
          Tap a bar to explore. The dashed line marks your reserve; red marks a
          breach. Both choices use the same scale.
        </Text>
        <View style={s.divider} />
        <View accessibilityLiveRegion="polite" style={s.between}>
          <Text style={s.label}>{dateLabel(selected.date)}</Text>
          <Text style={s.heading}>{money(selected.closingBalanceCents)}</Text>
        </View>
        <Text style={s.body}>
          {selected.safetyBufferViolation
            ? "Below your safety reserve"
            : "Safety reserve protected"}{" "}
          · {money(profile.safetyBufferCents)} reserve
        </Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Button
              title="Previous day"
              secondary
              disabled={dayIndex === 0}
              onPress={() => setDayIndex((index) => index - 1)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Next day"
              secondary
              disabled={dayIndex === scenario.days.length - 1}
              onPress={() => setDayIndex((index) => index + 1)}
            />
          </View>
        </View>
      </Card>
      <Card>
        <Text style={s.heading}>The moments that matter</Text>
        {scenario.days
          .flatMap((day) =>
            day.events
              .filter((event) =>
                ["bill", "income", "purchase"].includes(event.type),
              )
              .map((event) => ({ ...event, date: day.date })),
          )
          .slice(0, 6)
          .map((event) => (
            <View key={`${event.date}-${event.id}`} style={s.row}>
              <Icon
                name={
                  event.type === "income"
                    ? "arrow-down-left"
                    : event.type === "purchase"
                      ? "shopping-bag"
                      : "calendar"
                }
              />
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{event.name}</Text>
                <Text style={s.body}>{dateLabel(event.date)}</Text>
              </View>
              <Text style={s.label}>{money(event.amountCents)}</Text>
            </View>
          ))}
      </Card>
      <Card>
        <Text style={s.heading}>Your goals come along, too.</Text>
        {scenario.goalImpacts.map((goal) => (
          <View key={goal.goalId} style={{ gap: 8 }}>
            <Text style={s.label}>{goal.name}</Text>
            <Text style={s.body}>
              {goal.projectedDate
                ? `Projected: ${dateLabel(goal.projectedDate, true)}`
                : "Completion outside this forecast"}
              {goal.delayDays !== null
                ? ` · ${goal.delayDays === 0 ? "No delay" : `${goal.delayDays}-day delay`}`
                : ""}
            </Text>
          </View>
        ))}
      </Card>
      {current.dataSource === 'demo' && <Card tint={colors.soft}>
        <Text style={s.eyebrow}>Try a demo scenario</Text>
        <Text style={s.heading}>Life changes. Your plan can, too.</Text>
        <Text style={s.body}>
          See what a $430 car repair on September 20 does to your earliest safe
          purchase date.
        </Text>
        <Button
          title={repair ? "Remove demo car repair" : "Simulate Unexpected Expense"}
          icon="tool"
          onPress={toggleRepair}
          disabled={!ready || loading}
        />
        {change ? (
          <Text accessibilityLiveRegion="polite" style={s.body}>
            {change}
            {"\n"}New Safe Date:{" "}
            {analysis.safeDate
              ? dateLabel(analysis.safeDate, true)
              : "outside forecast"}
            .
          </Text>
        ) : null}
      </Card>}
      <Text style={[s.body, { fontSize: 12 }]}>
        Based on the September 12 demo profile, recurring bills and paychecks,
        and historical everyday spending. Projections are estimates.
      </Text>
      {current.change && <Card>
        <Text style={s.heading}>What changed in your financial data?</Text>
        <Text style={s.body}>{current.change.previousSafeDate ? dateLabel(current.change.previousSafeDate) : 'Outside forecast'} → {current.change.newSafeDate ? dateLabel(current.change.newSafeDate) : 'Outside forecast'}</Text>
        {current.change.causes.map((cause,i)=><Text key={i} style={s.body}>{cause.label}: {money(-cause.amountCents)}</Text>)}
      </Card>}
    </Screen>
  );
}
