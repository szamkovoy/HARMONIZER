import { Pressable, StyleSheet, View } from "react-native";

import { PRODUCT_TIERS, TIER_LABELS, type ProductTier } from "@/modules/access/core/tiers";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export function DevTierSwitch({
  value,
  onChange,
}: {
  value: ProductTier | null;
  onChange: (tier: ProductTier | null) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.root, { borderColor: theme.colors.surfaceBorder }]}>
      <AppText variant="technicalCaption" tone="muted">
        Dev effective tier: {value ? TIER_LABELS[value] : "из профиля"}
      </AppText>
      <View style={styles.row}>
        <TierButton label="Профиль" active={!value} onPress={() => onChange(null)} />
        {PRODUCT_TIERS.map((tier) => (
          <TierButton key={tier} label={TIER_LABELS[tier]} active={value === tier} onPress={() => onChange(tier)} />
        ))}
      </View>
    </View>
  );
}

function TierButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          borderColor: active ? theme.colors.accent : theme.colors.surfaceBorder,
          backgroundColor: active ? theme.colors.controlButtonPressedBg : "transparent",
          opacity: pressed ? 0.65 : 1,
        },
      ]}
    >
      <AppText variant="technicalCaption" tone={active ? "accent" : "muted"}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    borderRadius: 18,
    gap: 10,
    padding: 12,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  button: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
});
