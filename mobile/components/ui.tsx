import Feather from "@expo/vector-icons/Feather";
import { type ComponentProps, type ReactNode, useState } from "react";
import {
  type ColorValue,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { purchaseFromInput } from "../lib/model";
import { useApp } from "../lib/store";
export const colors = {
  bg: "#F7F6F0",
  ink: "#213E36",
  muted: "#64756D",
  green: "#245D47",
  soft: "#E8EFE5",
  line: "#DCE2D9",
  amber: "#865415",
  amberBg: "#FBEDD4",
  red: "#A34136",
  redBg: "#F9E5DF",
};
export type IconName = ComponentProps<typeof Feather>["name"];
export const Icon = ({
  name,
  color = colors.green,
  size = 22,
}: {
  name: IconName;
  color?: ColorValue;
  size?: number;
}) => (
  <Feather
    name={name}
    color={color}
    size={size}
    accessible={false}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    aria-hidden
  />
);
export function Screen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          s.screen,
          { paddingBottom: Math.max(28, insets.bottom + 16) },
        ]}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
export const Card = ({
  children,
  tint = "#FFFFFF",
}: {
  children: ReactNode;
  tint?: string;
}) => <View style={[s.card, { backgroundColor: tint }]}>{children}</View>;
export function Button({
  title,
  onPress,
  icon,
  secondary = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      {icon && <Icon name={icon} color={secondary ? colors.green : "#fff"} />}
      <Text style={[s.buttonText, secondary && { color: colors.green }]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function Note({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="alert" style={s.note}>
      {children}
    </Text>
  );
}
export function Field({
  label,
  value,
  onChangeText,
  price = false,
  secure = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  price?: boolean;
  secure?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType={price ? "decimal-pad" : "default"}
        secureTextEntry={secure}
        autoCapitalize={secure ? "none" : "sentences"}
        autoCorrect={!secure}
        maxLength={price ? 12 : 200}
        placeholder={price ? "0.00" : "Product name"}
        placeholderTextColor={colors.muted}
        style={s.input}
      />
    </View>
  );
}
export function PurchaseForm({
  initialName = "",
  initialPrice = "",
  category = "Other",
  title = "Check Purchase",
  onConfirmed,
}: {
  initialName?: string;
  initialPrice?: string;
  category?: string;
  title?: string;
  onConfirmed?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [price, setPrice] = useState(initialPrice);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const app = useApp();
  async function submit() {
    try {
      const purchase = purchaseFromInput(name, price, category);
      onConfirmed?.();
      setError("");
      setBusy(true);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      await app.check(purchase);
      router.push("/result");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Please check the product and price.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 16 }}>
      <Field label="Product" value={name} onChangeText={setName} />
      <Field label="Price · USD" value={price} onChangeText={setPrice} price />
      {error ? <Note>{error}</Note> : null}
      {busy ? (
        <View accessibilityLiveRegion="polite" style={s.row}>
          <ActivityIndicator color={colors.green} />
          <View style={{flex:1}}><Text style={s.body}>Checking your financial future…</Text><Text style={s.label}>Account balance · Bills · Spending behavior · Paycheck · Savings goals</Text></View>
        </View>
      ) : null}
      <Button
        title={busy ? "Checking…" : title}
        icon="arrow-right"
        onPress={() => void submit()}
        disabled={busy || !app.ready}
      />
    </View>
  );
}
export const s = StyleSheet.create({
  screen: {
    padding: 22,
    gap: 22,
    width: "100%",
    maxWidth: 580,
    alignSelf: "center",
  },
  card: {
    padding: 22,
    borderRadius: 24,
    gap: 16,
    shadowColor: "#213E36",
    shadowOpacity: 0.035,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 1,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: 34,
    lineHeight: 41,
    fontWeight: "700",
    letterSpacing: -1.1,
  },
  heading: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  label: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  eyebrow: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  amount: {
    color: colors.ink,
    fontSize: 43,
    fontWeight: "700",
    letterSpacing: -1.6,
  },
  button: {
    backgroundColor: colors.green,
    minHeight: 56,
    padding: 16,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  secondary: { backgroundColor: colors.soft },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  input: {
    backgroundColor: "#F6F7F3",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 15,
    fontSize: 17,
    color: colors.ink,
    minHeight: 54,
  },
  note: {
    color: colors.red,
    backgroundColor: colors.redBg,
    padding: 14,
    borderRadius: 14,
    fontSize: 14,
    lineHeight: 21,
  },
  divider: { height: 1, backgroundColor: colors.line },
  chip: {
    backgroundColor: colors.soft,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 30,
  },
});
