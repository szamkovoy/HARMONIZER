import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { PracticeSummary, PracticeVideoThumbnail } from "@/modules/practices/core/types";
import { clipDurationMinutesToSelectableMinutes } from "@/modules/practices/core/assistantSelectableDurations";
import { getPracticeCatalogStrings } from "@/modules/practices/i18n/practices";
import { useAppLocale } from "@/modules/i18n";
import {
  updateWearablePreferences,
  useWearablePreferences,
} from "@/modules/biofeedback/wearables/preferences";
import { chakraTagLabel } from "@/modules/chakra/i18n";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { fetchPracticeVimeoThumbnail } from "@/services/practice-thumbnails";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

const CHAKRA_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;
type SelectField = "duration" | "chakra" | "pulse" | null;

function durationLabel(practice: PracticeSummary, strings: ReturnType<typeof getPracticeCatalogStrings>): string {
  if (!practice.defaultDurationSec) {
    return practice.durationPolicy === "user_selectable" ? strings.durationSelectable : strings.durationPending;
  }
  const minutes = Math.max(1, Math.round(practice.defaultDurationSec / 60));
  return practice.durationPolicy === "user_selectable"
    ? `${strings.durationFromPrefix} ${minutes} ${strings.durationMinUnit}`
    : `${minutes} ${strings.durationMinUnit}`;
}

function chakraLabelForPractice(practice: PracticeSummary, strings: ReturnType<typeof getPracticeCatalogStrings>): string {
  if (practice.chakraIds.length) {
    return practice.chakraIds.map((chakra) => chakraTagLabel(strings.locale, chakra)).join(strings.locale === "en" ? ", " : ", ");
  }
  return strings.chakraPending;
}

function durationOptions(practice: PracticeSummary): number[] {
  if (practice.kind === "meditation") return Array.from({ length: 5 }, (_, index) => index + 1);
  if (practice.kind === "breath") return Array.from({ length: 16 }, (_, index) => index + 5);
  return [];
}

function defaultSelectableDurationMinutes(practice: PracticeSummary, selectable: readonly number[]): number {
  const fromCatalog = practice.defaultDurationSec ? Math.max(1, Math.round(practice.defaultDurationSec / 60)) : null;
  const fallback =
    practice.kind === "breath" ? 10 : practice.kind === "meditation" ? 3 : fromCatalog ?? 5;
  const candidate = fromCatalog ?? fallback;
  return selectable.includes(candidate) ? candidate : selectable[0] ?? candidate;
}

function defaultSelectableChakra(practice: PracticeSummary): number {
  return practice.primaryChakra ?? practice.chakraIds[0] ?? (practice.kind === "yoga" ? 6 : 1);
}

export const PracticeCard = memo(function PracticeCard({
  practice,
  onLaunch,
  onRemotePlay,
  remotePlayConnected = false,
  remotePlayDisabled = false,
  videoThumbnail,
  overrideDurationMinutes,
  overrideChakraIndex,
}: {
  practice: PracticeSummary;
  onLaunch: (practice: PracticeSummary) => void;
  onRemotePlay?: (practice: PracticeSummary) => void;
  remotePlayConnected?: boolean;
  remotePlayDisabled?: boolean;
  videoThumbnail?: PracticeVideoThumbnail | null;
  overrideDurationMinutes?: number;
  overrideChakraIndex?: number;
}) {
  const theme = useTheme();
  const { locale: appLocale } = useAppLocale();
  const wearablePreferences = useWearablePreferences();
  const strings = useMemo(() => getPracticeCatalogStrings(appLocale), [appLocale]);
  const minSuffix = strings.durationMinUnit;
  const [fallbackThumbnail, setFallbackThumbnail] = useState<PracticeVideoThumbnail | null>(null);
  const yogaThumbnail = videoThumbnail ?? practice.video?.thumbnail ?? fallbackThumbnail;
  const selectableDurations = useMemo(() => durationOptions(practice), [practice]);
  const durationTouchedRef = useRef(false);
  const [selectedDurationMin, setSelectedDurationMin] = useState(() => {
    const raw = overrideDurationMinutes ?? defaultSelectableDurationMinutes(practice, selectableDurations);
    return clipDurationMinutesToSelectableMinutes(raw, selectableDurations).value;
  });
  const [selectedChakra, setSelectedChakra] = useState<number>(() =>
    overrideChakraIndex ?? defaultSelectableChakra(practice),
  );
  const [selectedSensorMode, setSelectedSensorMode] = useState<"fingerCamera" | "ble" | "none">(
    practice.kind === "breath" ? wearablePreferences.preferredSensorMode : "fingerCamera",
  );
  const [openField, setOpenField] = useState<SelectField>(null);

  useEffect(() => {
    durationTouchedRef.current = false;
  }, [practice.id]);

  useEffect(() => {
    if (practice.kind !== "breath") return;
    setSelectedSensorMode(wearablePreferences.preferredSensorMode);
  }, [practice.id, practice.kind, wearablePreferences.preferredSensorMode]);

  useEffect(() => {
    if (practice.kind === "yoga" || !selectableDurations.length) return;
    if (durationTouchedRef.current) return;
    const raw = overrideDurationMinutes ?? defaultSelectableDurationMinutes(practice, selectableDurations);
    const { value, clipped } = clipDurationMinutesToSelectableMinutes(raw, selectableDurations);
    if (clipped) {
      console.log(
        `[PRACTICE_CARD_MISMATCH] ${JSON.stringify({
          markerDuration: overrideDurationMinutes ?? null,
          historyDuration: null,
          markerKind: null,
          historyKind: null,
          finalDuration: value,
          finalKind: practice.kind,
          conversationId: null,
          durationClipped: true,
          source: "practice_card_client_sync",
        })}`,
      );
    }
    setSelectedDurationMin(value);
  }, [overrideDurationMinutes, practice.defaultDurationSec, practice.id, practice.kind, selectableDurations]);

  useEffect(() => {
    if (practice.kind !== "yoga") return;
    const videoId = practice.video?.provider === "vimeo" ? practice.video.externalId?.trim() ?? "" : "";
    if (!videoId || videoThumbnail?.url || practice.video?.thumbnail?.url) {
      setFallbackThumbnail(null);
      return;
    }

    const controller = new AbortController();
    void fetchPracticeVimeoThumbnail({
      videoId,
      targetWidth: 295,
      signal: controller.signal,
    })
      .then((thumbnail) => {
        setFallbackThumbnail(thumbnail);
        logRuntimeEvent("practice_card:yoga_thumbnail_loaded", {
          practiceId: practice.id,
          videoId,
          loaded: Boolean(thumbnail?.url),
        }, "debug");
      })
      .catch((error: unknown) => {
        setFallbackThumbnail(null);
        logRuntimeEvent(
          "practice_card:yoga_thumbnail_error",
          {
            practiceId: practice.id,
            videoId,
            message: error instanceof Error ? error.message : String(error),
          },
          "warn",
        );
      });
    return () => controller.abort();
  }, [practice.id, practice.kind, practice.video?.externalId, practice.video?.provider, practice.video?.thumbnail?.url, videoThumbnail?.url]);

  const launchConfiguredPractice = () => {
    if (practice.kind === "yoga") {
      onLaunch(practice);
      return;
    }
    const launch = {
      ...practice.launch,
      durationMs: selectedDurationMin * 60_000,
      chakra: selectedChakra,
      ...(practice.kind === "breath"
        ? {
            sensorMode: selectedSensorMode,
            deviceId:
              selectedSensorMode === "ble" ? wearablePreferences.lastDeviceId ?? undefined : undefined,
            deviceName:
              selectedSensorMode === "ble" ? wearablePreferences.lastDeviceName ?? undefined : undefined,
            provider:
              selectedSensorMode === "ble" ? wearablePreferences.lastProvider ?? undefined : undefined,
            capabilityTier:
              selectedSensorMode === "ble"
                ? wearablePreferences.lastCapabilityTier ?? undefined
                : selectedSensorMode === "none"
                  ? "unsupported"
                  : undefined,
            autoReconnect:
              selectedSensorMode === "ble" ? wearablePreferences.autoReconnect : undefined,
            usePulseSensor: selectedSensorMode !== "none",
          }
        : {}),
    } as PracticeSummary["launch"];
    onLaunch({ ...practice, launch });
  };

  const sensorDropdownValue =
    selectedSensorMode === "fingerCamera"
      ? strings.sensorCameraOption
      : selectedSensorMode === "ble"
        ? wearablePreferences.lastDeviceName?.trim()
          ? wearablePreferences.lastDeviceName.trim()
          : strings.sensorBluetoothOption
        : strings.sensorNoneOption;

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
        <View style={styles.yogaPreviewRow}>
          <View
            style={[
              styles.thumbnailFrame,
              {
                backgroundColor: theme.colors.controlButtonBg,
                borderColor: theme.colors.surfaceBorder,
              },
            ]}
          >
            {yogaThumbnail?.url ? (
              <Image source={{ uri: yogaThumbnail.url }} style={styles.thumbnailImage} resizeMode="cover" />
            ) : (
              <View style={styles.thumbnailPlaceholder}>
                <AppText variant="technicalCaption" tone="muted">
                  {strings.videoLabel}
                </AppText>
              </View>
            )}
          </View>
          <View style={styles.yogaMetaColumn}>
            <MetaPill label={overrideDurationMinutes ? `${overrideDurationMinutes} ${minSuffix}` : durationLabel(practice, strings)} />
            <MetaPill label={overrideChakraIndex ? chakraTagLabel(strings.locale, overrideChakraIndex) : chakraLabelForPractice(practice, strings)} />
          </View>
        </View>
      ) : (
        <View style={styles.options}>
          <View style={styles.selectableMetaRow}>
            <DropdownField
              variant="pill"
              label={strings.durationLabel}
              value={`${selectedDurationMin} ${minSuffix}`}
              open={openField === "duration"}
              onToggle={() => setOpenField((field) => (field === "duration" ? null : "duration"))}
              options={selectableDurations.map((minutes) => ({
                key: String(minutes),
                label: `${minutes} ${minSuffix}`,
                active: selectedDurationMin === minutes,
                onPress: () => {
                  durationTouchedRef.current = true;
                  setSelectedDurationMin(minutes);
                  setOpenField(null);
                },
              }))}
            />
            <DropdownField
              variant="pill"
              label={strings.chakraLabel}
              value={chakraTagLabel(strings.locale, selectedChakra)}
              open={openField === "chakra"}
              onToggle={() => setOpenField((field) => (field === "chakra" ? null : "chakra"))}
              options={CHAKRA_OPTIONS.map((chakra) => ({
                key: String(chakra),
                label: chakraTagLabel(strings.locale, chakra),
                active: selectedChakra === chakra,
                onPress: () => {
                  setSelectedChakra(chakra);
                  setOpenField(null);
                },
              }))}
            />
            {practice.kind === "breath" ? (
              <DropdownField
                variant="pill"
                label={strings.pulseLabel}
                value={sensorDropdownValue}
                open={openField === "pulse"}
                onToggle={() => setOpenField((field) => (field === "pulse" ? null : "pulse"))}
                options={[
                  {
                    key: "pulse-camera",
                    label: strings.sensorCameraOption,
                    active: selectedSensorMode === "fingerCamera",
                    onPress: () => {
                      setSelectedSensorMode("fingerCamera");
                      void updateWearablePreferences({ preferredSensorMode: "fingerCamera" });
                      setOpenField(null);
                    },
                  },
                  {
                    key: "pulse-ble",
                    label: wearablePreferences.lastDeviceName?.trim()
                      ? `${strings.sensorBluetoothOption} · ${wearablePreferences.lastDeviceName.trim()}`
                      : strings.sensorBluetoothOption,
                    active: selectedSensorMode === "ble",
                    onPress: () => {
                      setSelectedSensorMode("ble");
                      void updateWearablePreferences({ preferredSensorMode: "ble" });
                      setOpenField(null);
                    },
                  },
                  {
                    key: "pulse-off",
                    label: strings.sensorNoneOption,
                    active: selectedSensorMode === "none",
                    onPress: () => {
                      setSelectedSensorMode("none");
                      void updateWearablePreferences({ preferredSensorMode: "none" });
                      setOpenField(null);
                    },
                  },
                ]}
              />
            ) : null}
          </View>
        </View>
      )}

      <View style={styles.buttonRow}>
        <AppButton
          label={practice.kind === "yoga" && remotePlayConnected ? strings.openOnPhone : strings.startPractice}
          onPress={launchConfiguredPractice}
          style={styles.button}
        />
        {practice.kind === "yoga" && remotePlayConnected && onRemotePlay ? (
          <AppButton
            label={strings.openOnTv}
            variant="secondary"
            onPress={() => onRemotePlay(practice)}
            disabled={remotePlayDisabled}
            style={styles.button}
          />
        ) : null}
      </View>
    </View>
  );
});

/** Треугольник как в стандартных combobox; один размер для открытого и закрытого состояния. */
function DropdownCaret({ open, color, compact }: { open: boolean; color: string; compact: boolean }) {
  return (
    <Text
      allowFontScaling={false}
      style={[compact ? styles.dropdownCaretPill : styles.dropdownCaretField, { color }]}
    >
      {open ? "\u25B2" : "\u25BC"}
    </Text>
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
  variant = "field",
  label,
  value,
  open,
  onToggle,
  options,
}: {
  variant?: "field" | "pill";
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
  const pill = variant === "pill";
  return (
    <View style={pill ? styles.dropdownFieldPill : styles.dropdownField}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [
          pill ? styles.dropdownPillButton : styles.dropdownButton,
          {
            backgroundColor: theme.colors.controlButtonBg,
            borderColor: open ? theme.colors.accent : theme.colors.surfaceBorder,
            opacity: pressed ? 0.82 : 1,
          },
        ]}
      >
        {pill ? (
          <View style={styles.dropdownPillValueRow}>
            <AppText variant="technicalCaption" tone="muted" style={styles.dropdownPillValue} numberOfLines={1}>
              {value}
            </AppText>
            <DropdownCaret open={open} color={theme.colors.textMuted} compact />
          </View>
        ) : (
          <View style={styles.dropdownFieldRow}>
            <View style={styles.dropdownText}>
              <AppText variant="technicalCaption" tone="muted">
                {label}
              </AppText>
              <AppText variant="buttonLabel">{value}</AppText>
            </View>
            <DropdownCaret open={open} color={theme.colors.textMuted} compact={false} />
          </View>
        )}
      </Pressable>

      {open ? (
        <View
          style={[
            styles.dropdownMenu,
            {
              borderColor: theme.colors.surfaceBorder,
              backgroundColor:
                theme.scheme === "light" ? "rgba(15, 23, 42, 0.055)" : "rgba(255, 255, 255, 0.07)",
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
  yogaPreviewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  yogaMetaColumn: {
    flex: 1,
    gap: 8,
    alignItems: "flex-start",
  },
  options: {
    gap: 8,
  },
  selectableMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "flex-start",
  },
  thumbnailFrame: {
    width: 120,
    height: 68,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: "hidden",
  },
  thumbnailImage: {
    width: "100%",
    height: "100%",
  },
  thumbnailPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
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
  dropdownFieldPill: {
    gap: 6,
    maxWidth: "100%",
  },
  dropdownButton: {
    minHeight: 54,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  dropdownPillButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
  dropdownPillValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexShrink: 1,
    minWidth: 0,
    gap: 5,
  },
  dropdownPillValue: {
    flexShrink: 1,
  },
  dropdownFieldRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    minWidth: 0,
  },
  dropdownCaretPill: {
    fontSize: 9,
    lineHeight: 16,
    fontWeight: "400",
    includeFontPadding: false,
    ...Platform.select({
      android: { textAlignVertical: "center" as const },
      default: {},
    }),
  },
  dropdownCaretField: {
    fontSize: 10,
    lineHeight: 20,
    fontWeight: "400",
    includeFontPadding: false,
    ...Platform.select({
      android: { textAlignVertical: "center" as const },
      default: {},
    }),
  },
  dropdownText: {
    flex: 1,
    gap: 1,
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
