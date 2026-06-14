import { Pressable, StyleSheet, View } from "react-native";

import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { PERIOD_PRESETS, type PeriodPreset } from "@/modules/profile/core/periodPresets";
import { getPeriodPresets } from "@/modules/profile/i18n/profile";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export function PeriodSelector(props: {
  value: number;
  onChange: (days: number) => void;
  presets?: readonly PeriodPreset[];
  locale?: AppContentLocale;
}) {
  const theme = useTheme();
  const presets = props.presets ?? (props.locale ? getPeriodPresets(props.locale) : PERIOD_PRESETS);

  return (
    <View style={styles.row}>
      {presets.map((preset) => {
        const selected = props.value === preset.days;
        return (
          <Pressable
            key={preset.id}
            onPress={() => props.onChange(preset.days)}
            style={[
              styles.button,
              {
                backgroundColor: selected ? theme.colors.accent : theme.colors.surfaceElevated,
                borderColor: selected ? theme.colors.accent : theme.colors.surfaceBorder,
              },
            ]}
          >
            <AppText variant="technicalCaption" tone={selected ? "accentOn" : "muted"}>
              {preset.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 8,
  },
  button: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
