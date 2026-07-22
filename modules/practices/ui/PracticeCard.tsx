import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import type { PracticeSummary, PracticeVideoThumbnail } from "@/modules/practices/core/types";
import { clipDurationMinutesToSelectableMinutes } from "@/modules/practices/core/assistantSelectableDurations";
import { getPracticeCatalogStrings } from "@/modules/practices/i18n/practices";
import { useAppLocale } from "@/modules/i18n";
import {
  updateWearablePreferences,
  useWearablePreferences,
} from "@/modules/biofeedback/wearables/preferences";
import { WearablePickerDialog } from "@/modules/biofeedback/wearables/WearablePickerDialog";
import type { WearableScanCandidate } from "@/modules/biofeedback/wearables/types";
import { useRememberedWearableProbe } from "@/modules/biofeedback/wearables/useRememberedWearableProbe";
import { isFingerFrameProcessorAvailable } from "@/modules/biofeedback-finger-frame-processor/src";
import { chakraTagLabel } from "@/modules/chakra/i18n";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { ComboBoxDismissOverlay, ComboBoxRow } from "@/modules/ui/ComboBox";
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
  remotePlayDisabled = false,
  videoThumbnail,
  overrideDurationMinutes,
  overrideChakraIndex,
}: {
  practice: PracticeSummary;
  onLaunch: (practice: PracticeSummary) => void;
  onRemotePlay?: (practice: PracticeSummary) => void;
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
  const [wearablePickerVisible, setWearablePickerVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setOpenField(null);
    }, []),
  );

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

  const hasRememberedWearable = Boolean(wearablePreferences.lastDeviceId?.trim());
  const rememberedWearableName = wearablePreferences.lastDeviceName?.trim() ?? "";
  const rememberedWearableProbe = useRememberedWearableProbe(
    wearablePreferences.lastDeviceId,
    practice.kind === "breath",
  );
  const rememberedWearableVisible =
    hasRememberedWearable && rememberedWearableProbe.available === true;
  const needsWearableSelection =
    practice.kind === "breath" && selectedSensorMode === "ble" && !rememberedWearableVisible;

  useFocusEffect(
    useCallback(() => {
      if (practice.kind === "breath") {
        rememberedWearableProbe.refresh();
      }
    }, [practice.kind, rememberedWearableProbe.refresh]),
  );

  // Reflect probe availability on the UI selection WITHOUT wiping the persisted preference.
  // The persisted `preferredSensorMode` is the user's INTENT (last manually chosen source); a
  // transient probe failure (e.g. right after returning from a BLE practice — the strap was just
  // disconnected and may not advertise within the 4 s probe window) must NOT overwrite it, or the
  // choice silently resets to "phone camera" forever (the catalog-restoration bug). When the strap
  // is genuinely unavailable we fall back the UI to camera for this view; when the probe succeeds
  // again (next focus / app open) we restore the "ble" selection. Manual dropdown changes still
  // write the preference via their own handlers.
  useEffect(() => {
    if (practice.kind !== "breath") return;
    if (wearablePreferences.preferredSensorMode !== "ble") return; // user wants camera/none — leave
    if (rememberedWearableProbe.available === true) {
      setSelectedSensorMode("ble");
    } else if (rememberedWearableProbe.available === false) {
      setSelectedSensorMode("fingerCamera");
    }
  }, [practice.kind, wearablePreferences.preferredSensorMode, rememberedWearableProbe.available]);

  const openWearablePicker = () => {
    setOpenField(null);
    setWearablePickerVisible(true);
  };

  const closeWearablePicker = () => {
    setWearablePickerVisible(false);
  };

  const selectWearableCandidate = (candidate: WearableScanCandidate) => {
    setSelectedSensorMode("ble");
    void updateWearablePreferences({
      preferredSensorMode: "ble",
      lastDeviceId: candidate.id,
      lastDeviceName: candidate.name,
      lastProvider: candidate.provider,
      lastCapabilityTier: candidate.capabilityTier === "unknown" ? null : candidate.capabilityTier,
    });
    closeWearablePicker();
  };

  const launchConfiguredPractice = () => {
    if (needsWearableSelection) {
      openWearablePicker();
      return;
    }
    if (practice.kind === "yoga") {
      onLaunch(practice);
      return;
    }
    // Android (and Expo Go): no finger PPG plugin → do not silently start as "without pulse".
    if (
      practice.kind === "breath" &&
      selectedSensorMode === "fingerCamera" &&
      !isFingerFrameProcessorAvailable()
    ) {
      Alert.alert(strings.sensorCameraUnavailableTitle, strings.sensorCameraUnavailableBody);
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
        ? rememberedWearableVisible && rememberedWearableName
          ? rememberedWearableName
          : strings.findWearableButton
        : strings.sensorNoneOption;
  const primaryButtonLabel =
    practice.kind === "yoga"
      ? strings.openOnPhone
      : needsWearableSelection
        ? strings.findWearableButton
        : strings.startPractice;

  return (
    <>
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
            <ComboBoxRow
              variant="pill"
              openId={openField}
              onOpenIdChange={(id) => {
                if (id === "duration" || id === "chakra" || id === "pulse" || id === null) {
                  setOpenField(id);
                }
              }}
              items={[
                {
                  id: "duration",
                  label: strings.durationLabel,
                  value: String(selectedDurationMin),
                  displayValue: `${selectedDurationMin} ${minSuffix}`,
                  options: selectableDurations.map((minutes) => ({
                    value: String(minutes),
                    label: `${minutes} ${minSuffix}`,
                  })),
                  onChange: (next) => {
                    durationTouchedRef.current = true;
                    setSelectedDurationMin(Number(next));
                  },
                },
                {
                  id: "chakra",
                  label: strings.chakraLabel,
                  value: String(selectedChakra),
                  displayValue: chakraTagLabel(strings.locale, selectedChakra),
                  options: CHAKRA_OPTIONS.map((chakra) => ({
                    value: String(chakra),
                    label: chakraTagLabel(strings.locale, chakra),
                  })),
                  onChange: (next) => {
                    setSelectedChakra(Number(next));
                  },
                },
                ...(practice.kind === "breath"
                  ? [
                      {
                        id: "pulse",
                        label: strings.pulseLabel,
                        value: selectedSensorMode,
                        displayValue: sensorDropdownValue,
                        options: [
                          {
                            value: "fingerCamera",
                            label: strings.sensorCameraOption,
                          },
                          ...(rememberedWearableVisible && rememberedWearableName
                            ? [
                                {
                                  value: "ble",
                                  label: rememberedWearableName,
                                },
                              ]
                            : []),
                          {
                            value: "find-ble",
                            label: strings.findWearableButton,
                          },
                          {
                            value: "none",
                            label: strings.sensorNoneOption,
                          },
                        ],
                        onChange: (next: string) => {
                          if (next === "find-ble") {
                            openWearablePicker();
                            return;
                          }
                          if (next === "fingerCamera" || next === "ble" || next === "none") {
                            setSelectedSensorMode(next);
                            void updateWearablePreferences({ preferredSensorMode: next });
                          }
                        },
                      },
                    ]
                  : []),
              ]}
            />
          </View>
        )}

        <View style={styles.buttonRow}>
          <AppButton
            label={primaryButtonLabel}
            onPress={launchConfiguredPractice}
            style={styles.button}
          />
          {practice.kind === "yoga" && onRemotePlay ? (
            <AppButton
              label={strings.openOnTv}
              variant="secondary"
              onPress={() => onRemotePlay(practice)}
              disabled={remotePlayDisabled}
              style={styles.button}
            />
          ) : null}
        </View>
        <ComboBoxDismissOverlay active={openField != null} onDismiss={() => setOpenField(null)} />
      </View>

      <WearablePickerDialog
        visible={wearablePickerVisible}
        onClose={closeWearablePicker}
        onSelect={selectWearableCandidate}
        strings={{
          title: strings.wearablePickerTitle,
          searchHint: strings.wearablePickerHint,
          foundHint: strings.wearablePickerFoundHint,
          notFoundHint: strings.wearablePickerNotFound,
          notFoundTips: strings.wearablePickerNotFoundTips,
          bluetoothOffHint: strings.wearablePickerBluetoothOff,
          permissionDeniedHint: strings.wearablePickerPermissionDenied,
          retryButton: strings.wearablePickerRetry,
          closeButton: strings.wearablePickerClose,
          selectButton: strings.wearablePickerSelectButton,
          signalLabel: strings.wearablePickerSignalLabel,
          bluetoothStateLabel: strings.wearableBluetoothStateLabel,
        }}
      />
    </>
  );
});

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

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    gap: 12,
    overflow: "visible",
    padding: 16,
    position: "relative",
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
});
