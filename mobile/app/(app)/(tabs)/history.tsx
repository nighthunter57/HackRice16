import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button, Card, Icon, Note, Screen, s } from "../../../components/ui";
import { money } from "../../../lib/model";
import { useApp } from "../../../lib/store";
export default function History() {
  const { history, open, ready, storageError } = useApp();
  return (
    <Screen>
      <Text style={s.title}>A little more{"\n"}sure each time.</Text>
      <Text style={s.body}>
        Your purchase checks and saved plans.
      </Text>
      {storageError ? <Note>{storageError}</Note> : null}
      {!ready ? (
        <Text style={s.body}>Loading your checks…</Text>
      ) : !history.length ? (
        <Card>
          <Icon name="clock" size={32} />
          <Text style={s.heading}>Your next decision starts here.</Text>
          <Text style={s.body}>
            Check something you’re considering. You can come back to it anytime.
          </Text>
          <Button
            title="Check a purchase"
            onPress={() => router.navigate("/(app)/(tabs)")}
          />
        </Card>
      ) : (
        history.map((entry) => (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${entry.purchase.productName}, ${money(entry.purchase.priceCents)}`}
            onPress={() => {
              open(entry);
              router.push("/result");
            }}
          >
            <Card>
              <View style={s.between}>
                <Text style={[s.heading, { flex: 1 }]}>
                  {entry.purchase.productName}
                </Text>
                <Icon name="arrow-up-right" />
              </View>
              <Text style={s.heading}>{money(entry.purchase.priceCents)}</Text>
              <Text style={s.body}>
                {entry.decision} ·{" "}
                {new Date(entry.checkedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </Text>
              <Text style={s.eyebrow}>
                {entry.dataSource === 'nessie'
                  ? 'Saved forecast'
                  : entry.dataSource === 'demo'
                    ? entry.repair ? 'Sample finances · car repair' : 'Sample finances'
                    : 'Saved result'}
              </Text>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
