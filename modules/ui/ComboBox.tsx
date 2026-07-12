import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export type ComboBoxOption<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type ComboBoxVariant = "pill" | "field";

export type ComboBoxItemConfig<T extends string = string> = {
  id: string;
  /** Accessibility label for the trigger. */
  label: string;
  value: T;
  options: ReadonlyArray<ComboBoxOption<T>>;
  onChange: (value: T) => void;
  /** Optional override for the closed trigger text. */
  displayValue?: string;
};

function ComboBoxCaret({ open, color, compact }: { open: boolean; color: string; compact: boolean }) {
  return (
    <Text
      allowFontScaling={false}
      style={[compact ? styles.caretPill : styles.caretField, { color }]}
    >
      {open ? "\u25B2" : "\u25BC"}
    </Text>
  );
}

function ComboBoxTrigger(props: {
  variant: ComboBoxVariant;
  label: string;
  displayValue: string;
  open: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const pill = props.variant === "pill";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ expanded: props.open }}
      onPress={props.onToggle}
      style={({ pressed }) => [
        pill ? styles.pillButton : styles.fieldButton,
        {
          backgroundColor: theme.colors.controlButtonBg,
          borderColor: props.open ? theme.colors.accent : theme.colors.surfaceBorder,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      {pill ? (
        <View style={styles.pillValueRow}>
          <AppText variant="technicalCaption" tone="muted" style={styles.pillValue} numberOfLines={1}>
            {props.displayValue}
          </AppText>
          <ComboBoxCaret open={props.open} color={theme.colors.textMuted} compact />
        </View>
      ) : (
        <View style={styles.fieldRow}>
          <View style={styles.fieldText}>
            <AppText variant="technicalCaption" tone="muted">
              {props.label}
            </AppText>
            <AppText variant="buttonLabel">{props.displayValue}</AppText>
          </View>
          <ComboBoxCaret open={props.open} color={theme.colors.textMuted} compact={false} />
        </View>
      )}
    </Pressable>
  );
}

function ComboBoxMenu<T extends string>(props: {
  options: ReadonlyArray<ComboBoxOption<T>>;
  value: T;
  onChange: (value: T) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.menu,
        {
          borderColor: theme.colors.surfaceBorder,
          backgroundColor:
            theme.scheme === "light" ? "rgba(15, 23, 42, 0.055)" : "rgba(255, 255, 255, 0.07)",
        },
      ]}
    >
      {props.options.map((option) => {
        const active = option.value === props.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            disabled={option.disabled}
            onPress={() => {
              if (option.disabled) return;
              props.onChange(option.value);
              props.onClose();
            }}
            style={({ pressed }) => [
              styles.option,
              {
                opacity: option.disabled ? 0.45 : 1,
                backgroundColor: active
                  ? theme.colors.buttonPrimaryBg
                  : pressed
                    ? theme.colors.controlButtonPressedBg
                    : "transparent",
              },
            ]}
          >
            <AppText variant="statPillLabel" tone={active ? "accentOn" : "primary"}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Full-bleed press target for a relatively-positioned parent; closes the open combo. */
export function ComboBoxDismissOverlay(props: { active: boolean; onDismiss: () => void }) {
  if (!props.active) return null;
  return (
    <Pressable
      accessible={false}
      onPress={props.onDismiss}
      style={[StyleSheet.absoluteFillObject, styles.dismissOverlay]}
    />
  );
}

/**
 * Row of combo triggers that keep their place when open; the options panel
 * renders full-width under the row so only following form rows shift down.
 */
export function ComboBoxRow<T extends string>(props: {
  items: ReadonlyArray<ComboBoxItemConfig<T>>;
  variant?: ComboBoxVariant;
  openId: string | null;
  onOpenIdChange: (id: string | null) => void;
}) {
  const variant = props.variant ?? "pill";
  const openItem = props.items.find((item) => item.id === props.openId) ?? null;

  return (
    <View style={styles.group}>
      <View style={styles.triggersRow}>
        {props.items.map((item) => {
          const open = props.openId === item.id;
          const selected = item.options.find((option) => option.value === item.value);
          return (
            <ComboBoxTrigger
              key={item.id}
              variant={variant}
              label={item.label}
              displayValue={item.displayValue ?? selected?.label ?? String(item.value)}
              open={open}
              onToggle={() => props.onOpenIdChange(open ? null : item.id)}
            />
          );
        })}
      </View>
      {openItem ? (
        <ComboBoxMenu
          options={openItem.options}
          value={openItem.value}
          onChange={openItem.onChange}
          onClose={() => props.onOpenIdChange(null)}
        />
      ) : null}
    </View>
  );
}

/** Single combo-box built on the shared row layout (menu under the trigger row). */
export function ComboBox<T extends string>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<ComboBoxOption<T>>;
  onChange: (value: T) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: ComboBoxVariant;
  displayValue?: string;
  id?: string;
}) {
  const id = props.id ?? "combo";
  return (
    <ComboBoxRow
      variant={props.variant}
      openId={props.open ? id : null}
      onOpenIdChange={(next) => props.onOpenChange(next === id)}
      items={[
        {
          id,
          label: props.label,
          value: props.value,
          options: props.options,
          onChange: props.onChange,
          displayValue: props.displayValue,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dismissOverlay: {
    elevation: 1,
    zIndex: 1,
  },
  group: {
    alignSelf: "stretch",
    elevation: 2,
    gap: 6,
    zIndex: 2,
  },
  triggersRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pillButton: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  fieldButton: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillValueRow: {
    alignItems: "baseline",
    flexDirection: "row",
    flexShrink: 1,
    gap: 5,
    minWidth: 0,
  },
  pillValue: {
    flexShrink: 1,
  },
  fieldRow: {
    alignItems: "baseline",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  fieldText: {
    flex: 1,
    gap: 1,
  },
  caretPill: {
    fontSize: 9,
    fontWeight: "400",
    includeFontPadding: false,
    lineHeight: 16,
    ...Platform.select({
      android: { textAlignVertical: "center" as const },
      default: {},
    }),
  },
  caretField: {
    fontSize: 10,
    fontWeight: "400",
    includeFontPadding: false,
    lineHeight: 20,
    ...Platform.select({
      android: { textAlignVertical: "center" as const },
      default: {},
    }),
  },
  menu: {
    alignSelf: "stretch",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    padding: 6,
  },
  option: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
});
