import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Platform, StyleSheet, View } from "react-native";
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
import {
  ensureWearableLiveLink,
  isWearableLiveLinkReady,
  releaseWearableConnection,
} from "@/modules/biofeedback/wearables/wearableConnectionHold";
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
  const [bleWarmLaunching, setBleWarmLaunching] = useState(false);
  const [androidLiveDeviceId, setAndroidLiveDeviceId] = useState<string | null>(null);
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
    // Pause probe while the picker owns the BLE scanner — parallel scans on Android
    // race with "Cannot start scanning" and used to show a false "Bluetooth busy" banner.
    practice.kind === "breath" && !wearablePickerVisible,
  );
  // Android: show Polar only when OS-link was completed AND probe still sees it
  // (or we have a live hold). After Forget in phone BT settings, probe → false → hide.
  const rememberedWearableVisible =
    hasRememberedWearable &&
    Boolean(rememberedWearableName) &&
    (selectedSensorMode === "ble" || wearablePreferences.preferredSensorMode === "ble") &&
    (Platform.OS !== "android" ||
      (wearablePreferences.androidOsLinkReady &&
        (isWearableLiveLinkReady(wearablePreferences.lastDeviceId ?? "", 30_000) ||
          rememberedWearableProbe.available === true ||
          rememberedWearableProbe.probing)));
  const needsWearableSelection =
    practice.kind === "breath" &&
    selectedSensorMode === "ble" &&
    (!hasRememberedWearable ||
      (Platform.OS === "android" && !wearablePreferences.androidOsLinkReady));

  useFocusEffect(
    useCallback(() => {
      if (practice.kind === "breath") {
        rememberedWearableProbe.refresh();
      }
    }, [practice.kind, rememberedWearableProbe.refresh]),
  );

  // Keep UI in sync with persisted BLE intent.
  useEffect(() => {
    if (practice.kind !== "breath") return;
    if (wearablePreferences.preferredSensorMode === "ble") {
      setSelectedSensorMode("ble");
    }
  }, [practice.kind, wearablePreferences.preferredSensorMode]);

  // Sync live-link badge from hold module / prefs (Android).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const id = wearablePreferences.lastDeviceId?.trim() ?? "";
    if (id && wearablePreferences.androidOsLinkReady && isWearableLiveLinkReady(id, 30_000)) {
      setAndroidLiveDeviceId(id);
    }
  }, [wearablePreferences.androidOsLinkReady, wearablePreferences.lastDeviceId]);

  // Android: strap gone from radio (BT on, probe finished) → hide + default «без пульсометра».
  useEffect(() => {
    if (Platform.OS !== "android" || practice.kind !== "breath") return;
    if (!hasRememberedWearable) return;
    if (rememberedWearableProbe.probing) return;
    if (rememberedWearableProbe.available !== false) return;
    setSelectedSensorMode("none");
    setAndroidLiveDeviceId(null);
    void releaseWearableConnection();
    void updateWearablePreferences({
      preferredSensorMode: "none",
      lastDeviceId: null,
      lastDeviceName: null,
      lastProvider: null,
      lastCapabilityTier: null,
      androidOsLinkReady: false,
    });
  }, [
    hasRememberedWearable,
    practice.kind,
    rememberedWearableProbe.available,
    rememberedWearableProbe.probing,
  ]);

  const openWearablePicker = () => {
    setOpenField(null);
    setWearablePickerVisible(true);
  };

  const closeWearablePicker = () => {
    setWearablePickerVisible(false);
  };

  /** Persist selection (iOS closes; Android stays open until live connect succeeds). */
  const selectWearableCandidate = (candidate: WearableScanCandidate) => {
    setSelectedSensorMode("ble");
    void updateWearablePreferences({
      preferredSensorMode: "ble",
      lastDeviceId: candidate.id,
      lastDeviceName: candidate.name.trim() || candidate.id,
      lastProvider: candidate.provider,
      lastCapabilityTier: candidate.capabilityTier === "unknown" ? null : candidate.capabilityTier,
    });
    if (Platform.OS !== "android") {
      closeWearablePicker();
    }
  };

  const connectWearableLive = async (candidate: WearableScanCandidate): Promise<boolean> => {
    const ok = await ensureWearableLiveLink(candidate.id);
    if (!ok) {
      setAndroidLiveDeviceId(null);
      void updateWearablePreferences({ androidOsLinkReady: false });
      Alert.alert(strings.wearableLinkFailedTitle, strings.wearableLinkFailedBody, [
        { text: strings.wearableLinkRetry, style: "cancel" },
      ]);
      return false;
    }
    setAndroidLiveDeviceId(candidate.id);
    setSelectedSensorMode("ble");
    void updateWearablePreferences({
      preferredSensorMode: "ble",
      lastDeviceId: candidate.id,
      lastDeviceName: candidate.name.trim() || candidate.id,
      lastProvider: candidate.provider,
      lastCapabilityTier: candidate.capabilityTier === "unknown" ? null : candidate.capabilityTier,
      androidOsLinkReady: true,
    });
    return true;
  };

  const disconnectWearable = () => {
    setSelectedSensorMode("none");
    setAndroidLiveDeviceId(null);
    void releaseWearableConnection();
    void updateWearablePreferences({
      preferredSensorMode: "none",
      lastDeviceId: null,
      lastDeviceName: null,
      lastProvider: null,
      lastCapabilityTier: null,
      androidOsLinkReady: false,
    });
    closeWearablePicker();
  };

  const launchConfiguredPractice = () => {
    if (bleWarmLaunching) return;
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

    const runLaunch = () => {
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

    // Android: pair/system prompts belong in the picker. Start only reconnects
    // a previously verified OS link (usually silent). Never open practice unlinked.
    const bleDeviceId =
      practice.kind === "breath" && selectedSensorMode === "ble"
        ? wearablePreferences.lastDeviceId?.trim()
        : "";
    if (bleDeviceId && Platform.OS === "android") {
      if (!wearablePreferences.androidOsLinkReady) {
        openWearablePicker();
        return;
      }
      // Fresh live stream from picker — open practice without another connectToDevice.
      if (isWearableLiveLinkReady(bleDeviceId, 30_000)) {
        runLaunch();
        return;
      }
      setBleWarmLaunching(true);
      void ensureWearableLiveLink(bleDeviceId)
        .then((ok) => {
          // ensure reuses open GATT when possible — avoids a second OS pair banner.
          if (!ok) {
            void updateWearablePreferences({ androidOsLinkReady: false });
            setAndroidLiveDeviceId(null);
            Alert.alert(strings.wearableLinkFailedTitle, strings.wearableLinkFailedBody, [
              { text: strings.wearableLinkRetry, onPress: () => openWearablePicker() },
              { text: strings.wearablePickerClose, style: "cancel" },
            ]);
            return;
          }
          setAndroidLiveDeviceId(bleDeviceId);
          runLaunch();
        })
        .catch(() => {
          Alert.alert(strings.wearableLinkFailedTitle, strings.wearableLinkFailedBody, [
            { text: strings.wearableLinkRetry, onPress: () => openWearablePicker() },
          ]);
        })
        .finally(() => setBleWarmLaunching(false));
      return;
    }
    runLaunch();
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
        : bleWarmLaunching
          ? strings.connectingWearableButton
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
            disabled={bleWarmLaunching}
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
        onDisconnect={disconnectWearable}
        selectedDeviceId={wearablePreferences.lastDeviceId}
        liveLinkedDeviceId={
          Platform.OS === "android" ? androidLiveDeviceId : wearablePreferences.lastDeviceId
        }
        onConnectLive={Platform.OS === "android" ? connectWearableLive : undefined}
        strings={{
          title: strings.wearablePickerTitle,
          searchHint: strings.wearablePickerHint,
          foundHint: strings.wearablePickerFoundHint,
          connectedHint: strings.wearablePickerConnectedHint,
          notFoundHint: strings.wearablePickerNotFound,
          notFoundTips: strings.wearablePickerNotFoundTips,
          bluetoothOffHint: strings.wearablePickerBluetoothOff,
          permissionDeniedHint: strings.wearablePickerPermissionDenied,
          scanBusyHint: strings.wearablePickerScanBusy,
          retryButton: strings.wearablePickerRetry,
          closeButton: strings.wearablePickerClose,
          selectButton: strings.wearablePickerSelectButton,
          connectedLabel: strings.wearablePickerConnectedLabel,
          foundNotConnectedLabel: strings.wearablePickerFoundNotConnectedLabel,
          disconnectButton: strings.wearablePickerDisconnectButton,
          signalLabel: strings.wearablePickerSignalLabel,
          bluetoothStateLabel: strings.wearableBluetoothStateLabel,
          linkingHint: strings.wearablePickerLinkingHint,
          linkingButton: strings.wearablePickerLinkingButton,
          linkingStatusLabel: strings.wearablePickerLinkingStatusLabel,
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
