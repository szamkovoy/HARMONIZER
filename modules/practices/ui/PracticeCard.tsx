import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { PracticeSummary } from "@/modules/practices/core/types";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

const CHAKRA_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;
type SelectField = "duration" | "chakra" | "pulse" | null;

function durationLabel(practice: PracticeSummary): string {
  if (!practice.defaultDurationSec) {
    return practice.durationPolicy === "user_selectable" ? "длительность выбирается" : "длительность уточняется";
  }
  const minutes = Math.max(1, Math.round(practice.defaultDurationSec / 60));
  return practice.durationPolicy === "user_selectable" ? `от ${minutes} мин` : `${minutes} мин`;
}

function chakraLabel(practice: PracticeSummary): string {
  if (practice.chakraIds.length) return practice.chakraIds.map((chakra) => `${chakra} чакра`).join(", ");
  return "чакра уточняется";
}

function durationOptions(practice: PracticeSummary): number[] {
  if (practice.kind === "meditation") return Array.from({ length: 10 }, (_, index) => index + 1);
  if (practice.kind === "breath") return Array.from({ length: 16 }, (_, index) => index + 5);
  return [];
}

export function PracticeCard({
  practice,
  onLaunch,
  onRemotePlay,
  remotePlayConnected = false,
  remotePlayDisabled = false,
}: {
  practice: PracticeSummary;
  onLaunch: (practice: PracticeSummary) => void;
  onRemotePlay?: (practice: PracticeSummary) => void;
  remotePlayConnected?: boolean;
  remotePlayDisabled?: boolean;
}) {
  const theme = useTheme();
  const selectableDurations = useMemo(() => durationOptions(practice), [practice]);
  const [selectedDurationMin, setSelectedDurationMin] = useState(() => {
    const fallback = practice.kind === "breath" ? 10 : 5;
    const minutes = practice.defaultDurationSec ? Math.max(1, Math.round(practice.defaultDurationSec / 60)) : fallback;
    return selectableDurations.includes(minutes) ? minutes : selectableDurations[0] ?? minutes;
  });
  const [selectedChakra, setSelectedChakra] = useState<number>(practice.primaryChakra ?? practice.chakraIds[0] ?? 6);
  const [usePulseSensor, setUsePulseSensor] = useState(true);
  const [openField, setOpenField] = useState<SelectField>(null);

  const launchConfiguredPractice = () => {
    if (practice.kind === "yoga") {
      onLaunch(practice);
      return;
    }
    const launch = {
      ...practice.launch,
      durationMs: selectedDurationMin * 60_000,
      chakra: selectedChakra,
      ...(practice.kind === "breath" ? { usePulseSensor } : {}),
    } as PracticeSummary["launch"];
    onLaunch({ ...practice, launch });
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surfaceElevated,
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <AppText variant="sectionTitle">{practice.title}</AppText>
          {practice.subtitle ? (
            <AppText variant="technicalCaption" tone="muted">
              {practice.subtitle}
            </AppText>
          ) : null}
        </View>
      </View>

      {practice.description ? (
        <AppText variant="dialogBody" tone="muted">
          {practice.description}
        </AppText>
      ) : null}

      {practice.kind === "yoga" ? (
        <View style={styles.metaRow}>
          <MetaPill label={durationLabel(practice)} />
          <MetaPill label={chakraLabel(practice)} />
        </View>
      ) : (
        <View style={styles.options}>
          <DropdownField
            label="Длительность"
            value={`${selectedDurationMin} мин`}
            open={openField === "duration"}
            onToggle={() => setOpenField((field) => (field === "duration" ? null : "duration"))}
            options={selectableDurations.map((minutes) => ({
              key: String(minutes),
              label: `${minutes} мин`,
              active: selectedDurationMin === minutes,
              onPress: () => {
                setSelectedDurationMin(minutes);
                setOpenField(null);
              },
            }))}
          />
          <DropdownField
            label="Чакра"
            value={`${selectedChakra} чакра`}
            open={openField === "chakra"}
            onToggle={() => setOpenField((field) => (field === "chakra" ? null : "chakra"))}
            options={CHAKRA_OPTIONS.map((chakra) => ({
              key: String(chakra),
              label: `${chakra} чакра`,
              active: selectedChakra === chakra,
              onPress: () => {
                setSelectedChakra(chakra);
                setOpenField(null);
              },
            }))}
          />
          {practice.kind === "breath" ? (
            <DropdownField
              label="Пульсометр"
              value={usePulseSensor ? "с пульсометром" : "без пульсометра"}
              open={openField === "pulse"}
              onToggle={() => setOpenField((field) => (field === "pulse" ? null : "pulse"))}
              options={[
                {
                  key: "pulse-on",
                  label: "с пульсометром",
                  active: usePulseSensor,
                  onPress: () => {
                    setUsePulseSensor(true);
                    setOpenField(null);
                  },
                },
                {
                  key: "pulse-off",
                  label: "без пульсометра",
                  active: !usePulseSensor,
                  onPress: () => {
                    setUsePulseSensor(false);
                    setOpenField(null);
                  },
                },
              ]}
            />
          ) : null}
        </View>
      )}

      <View style={styles.buttonRow}>
        <AppButton
          label={practice.kind === "yoga" && remotePlayConnected ? "Открыть на телефоне" : "Начать практику"}
          onPress={launchConfiguredPractice}
          style={styles.button}
        />
        {practice.kind === "yoga" && remotePlayConnected && onRemotePlay ? (
          <AppButton
            label="Открыть на ТВ"
            variant="secondary"
            onPress={() => onRemotePlay(practice)}
            disabled={remotePlayDisabled}
            style={styles.button}
          />
        ) : null}
      </View>
    </View>
  );
}

function MetaPill({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.metaPill,
        {
          backgroundColor: theme.colors.controlButtonBg,
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <AppText variant="technicalCaption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

function DropdownField({
  label,
  value,
  open,
  onToggle,
  options,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  options: Array<{
    key: string;
    label: string;
    active: boolean;
    onPress: () => void;
  }>;
}) {
  const theme = useTheme();
  return (
    <View style={styles.dropdownField}>
      <Pressable
        accessibilityRole="button"
        onPress={onToggle}
        style={({ pressed }) => [
          styles.dropdownButton,
          {
            backgroundColor: theme.colors.controlButtonBg,
            borderColor: open ? theme.colors.accent : theme.colors.surfaceBorder,
            opacity: pressed ? 0.82 : 1,
          },
        ]}
      >
        <View style={styles.dropdownText}>
          <AppText variant="technicalCaption" tone="muted">
            {label}
          </AppText>
          <AppText variant="buttonLabel">{value}</AppText>
        </View>
        <AppText variant="sectionTitle" tone="muted" style={styles.chevron}>
          {open ? "⌃" : "⌄"}
        </AppText>
      </Pressable>

      {open ? (
        <View
          style={[
            styles.dropdownMenu,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          {options.map((option) => (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              onPress={option.onPress}
              style={({ pressed }) => [
                styles.dropdownOption,
                {
                  backgroundColor: option.active
                    ? theme.colors.buttonPrimaryBg
                    : pressed
                      ? theme.colors.controlButtonPressedBg
                      : "transparent",
                },
              ]}
            >
              <AppText variant="statPillLabel" tone={option.active ? "accentOn" : "primary"}>
                {option.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  options: {
    gap: 8,
  },
  metaPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  button: {
    alignSelf: "flex-start",
    minWidth: 160,
  },
  buttonRow: {
    alignItems: "flex-start",
    gap: 8,
  },
  dropdownField: {
    gap: 6,
  },
  dropdownButton: {
    minHeight: 54,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  dropdownText: {
    flex: 1,
    gap: 1,
  },
  chevron: {
    fontSize: 18,
    lineHeight: 20,
  },
  dropdownMenu: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  dropdownOption: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
});
