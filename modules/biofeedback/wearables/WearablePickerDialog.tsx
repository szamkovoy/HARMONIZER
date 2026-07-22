import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import type { WearableScanCandidate } from "@/modules/biofeedback/wearables/types";
import { useWearableScanner } from "@/modules/biofeedback/wearables/useWearableScanner";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

const BLE_SCAN_WINDOW_MS = 12_000;

export interface WearablePickerDialogStrings {
  title: string;
  searchHint: string;
  foundHint: string;
  /** Shown when a listed candidate already has a verified live link. */
  connectedHint?: string;
  notFoundHint: string;
  notFoundTips?: string;
  bluetoothOffHint: string;
  permissionDeniedHint?: string;
  scanBusyHint?: string;
  retryButton: string;
  closeButton: string;
  selectButton: string;
  /** Label when this candidate has a live GATT / OS link (not merely remembered). */
  connectedLabel?: string;
  /** Android: found in scan but live link not verified yet. */
  foundNotConnectedLabel?: string;
  disconnectButton?: string;
  signalLabel: string;
  bluetoothStateLabel: string;
  /** Android: shown while waiting for system banners + sustained HR. */
  linkingHint?: string;
  linkingButton?: string;
  /** Android: status line under the device name while linking. */
  linkingStatusLabel?: string;
}

export function WearablePickerDialog({
  visible,
  strings,
  onClose,
  onSelect,
  onDisconnect,
  selectedDeviceId,
  /** Device id with a verified live link — only this shows «Подключен». */
  liveLinkedDeviceId,
  /** Android: async connect from «Подключить»; resolve true only after live HR. */
  onConnectLive,
  alertMessage,
}: {
  visible: boolean;
  strings: WearablePickerDialogStrings;
  onClose: () => void;
  onSelect: (candidate: WearableScanCandidate) => void;
  onDisconnect?: () => void;
  selectedDeviceId?: string | null;
  liveLinkedDeviceId?: string | null;
  onConnectLive?: (candidate: WearableScanCandidate) => Promise<boolean>;
  alertMessage?: string | null;
}) {
  const theme = useTheme();
  const { bluetoothState, scanState, scanError, devices: scannedWearables, startScan, stopScan } =
    useWearableScanner();
  const [scanAttempt, setScanAttempt] = useState(0);
  const [searchFinished, setSearchFinished] = useState(false);
  const scanStartedAtMsRef = useRef<number | null>(null);
  const [actionsWidth, setActionsWidth] = useState(0);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const ACTION_BUTTON_GAP = 8;
  const useLiveConnect = Platform.OS === "android" && typeof onConnectLive === "function";

  const onActionsLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setActionsWidth(w);
  };
  const equalButtonWidth = actionsWidth > 0 ? (actionsWidth - ACTION_BUTTON_GAP) / 2 : 0;

  useEffect(() => {
    if (!visible) {
      setSearchFinished(false);
      scanStartedAtMsRef.current = null;
      setLinkingId(null);
      void stopScan();
      return;
    }
    setSearchFinished(false);
    scanStartedAtMsRef.current = null;
    void startScan();
    return () => {
      void stopScan();
    };
  }, [scanAttempt, startScan, stopScan, visible]);

  useEffect(() => {
    if (scanState === "scanning") {
      scanStartedAtMsRef.current = Date.now();
      return;
    }
    if (scanState === "idle" || scanState === "failed") {
      scanStartedAtMsRef.current = null;
    }
  }, [scanState]);

  useEffect(() => {
    if (!visible || scanState !== "scanning" || scanStartedAtMsRef.current == null) return;
    const elapsedMs = Date.now() - scanStartedAtMsRef.current;
    const remainingMs = Math.max(0, BLE_SCAN_WINDOW_MS - elapsedMs);
    const timeoutId = setTimeout(() => {
      setSearchFinished(true);
      void stopScan();
    }, remainingMs);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [scanAttempt, scanState, stopScan, visible]);

  useEffect(() => {
    if (!visible || !searchFinished || scannedWearables.length === 0) return;
    setSearchFinished(false);
  }, [scannedWearables.length, searchFinished, visible]);

  const anyConnectedListed = scannedWearables.some((candidate) => {
    if (useLiveConnect) {
      return Boolean(liveLinkedDeviceId?.trim()) && candidate.id === liveLinkedDeviceId?.trim();
    }
    return Boolean(selectedDeviceId?.trim()) && candidate.id === selectedDeviceId?.trim();
  });

  const bodyMessage =
    bluetoothState !== "PoweredOn"
      ? strings.bluetoothOffHint
      : linkingId
        ? strings.linkingHint ?? strings.searchHint
        : anyConnectedListed
          ? strings.connectedHint ?? strings.foundHint
          : scannedWearables.length
            ? strings.foundHint
            : searchFinished
              ? strings.notFoundHint
              : strings.searchHint;
  const showNotFoundTips =
    searchFinished && scannedWearables.length === 0 && strings.notFoundTips != null && !linkingId;
  const showRetryButton =
    showNotFoundTips && bluetoothState === "PoweredOn" && scanState !== "scanning";

  const handleConnectPress = (candidate: WearableScanCandidate) => {
    if (linkingId) return;
    void stopScan().finally(() => {
      if (!useLiveConnect || !onConnectLive) {
        onSelect(candidate);
        return;
      }
      setLinkingId(candidate.id);
      void onConnectLive(candidate)
        .then((ok) => {
          if (ok) {
            // Stay in the modal so the user sees «Подключен».
            onSelect(candidate);
          }
        })
        .finally(() => setLinkingId(null));
    });
  };

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          <AppText variant="dialogTitle" tone="primary">
            {strings.title}
          </AppText>
          {alertMessage ? (
            <AppText variant="dialogBody" tone="primary">
              {alertMessage}
            </AppText>
          ) : null}
          <AppText variant="dialogBody" tone="muted">
            {bodyMessage}
          </AppText>
          {showNotFoundTips ? (
            <AppText variant="dialogBody" tone="muted" style={styles.notFoundTips}>
              {strings.notFoundTips}
            </AppText>
          ) : null}
          {scanError && scannedWearables.length === 0 ? (
            <AppText variant="dialogBody" tone="muted">
              {scanError === "bluetooth_permission_denied"
                ? strings.permissionDeniedHint ?? strings.bluetoothOffHint
                : scanError === "bluetooth_scan_busy"
                  ? strings.scanBusyHint ?? strings.bluetoothOffHint
                  : scanError}
            </AppText>
          ) : null}
          {(scanState === "scanning" && scannedWearables.length === 0) || linkingId ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
          ) : null}
          {scannedWearables.length ? (
            <View style={styles.candidates}>
              {scannedWearables.slice(0, 6).map((candidate) => {
                const isLiveLinked =
                  Boolean(liveLinkedDeviceId?.trim()) &&
                  candidate.id === liveLinkedDeviceId?.trim();
                // iOS / callers without live tracking: remembered selection ≈ connected.
                const isRememberedConnected =
                  !useLiveConnect &&
                  Boolean(selectedDeviceId?.trim()) &&
                  candidate.id === selectedDeviceId?.trim();
                const showAsConnected = isLiveLinked || isRememberedConnected;
                const isLinking = linkingId === candidate.id;
                const showDisconnect =
                  showAsConnected && onDisconnect != null && strings.disconnectButton && !isLinking;
                return (
                  <View
                    key={candidate.id}
                    style={[
                      styles.candidateCard,
                      {
                        backgroundColor: theme.colors.controlButtonBg,
                        borderColor: theme.colors.surfaceBorder,
                      },
                    ]}
                  >
                    <View style={styles.candidateText}>
                      <AppText variant="buttonLabel">{candidate.name}</AppText>
                      <AppText variant="dialogBody" tone="muted">
                        {isLinking
                          ? strings.linkingStatusLabel ??
                            strings.linkingButton ??
                            strings.selectButton
                          : showAsConnected && strings.connectedLabel
                            ? strings.connectedLabel
                            : useLiveConnect && strings.foundNotConnectedLabel
                              ? strings.foundNotConnectedLabel
                              : candidate.rssi != null
                                ? `${strings.signalLabel} ${candidate.rssi}`
                                : `${strings.bluetoothStateLabel}: ${bluetoothState}`}
                      </AppText>
                    </View>
                    {showDisconnect ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          void stopScan().finally(() => onDisconnect());
                        }}
                        style={({ pressed }) => [
                          styles.selectButton,
                          {
                            backgroundColor: pressed
                              ? theme.colors.controlButtonPressedBg
                              : theme.colors.controlButtonBg,
                            borderWidth: StyleSheet.hairlineWidth,
                            borderColor: theme.colors.surfaceBorder,
                          },
                        ]}
                      >
                        <AppText variant="statPillLabel" tone="primary">
                          {strings.disconnectButton}
                        </AppText>
                      </Pressable>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        disabled={Boolean(linkingId)}
                        onPress={() => handleConnectPress(candidate)}
                        style={({ pressed }) => [
                          styles.selectButton,
                          {
                            opacity: linkingId && !isLinking ? 0.45 : 1,
                            backgroundColor: pressed
                              ? theme.colors.controlButtonPressedBg
                              : theme.colors.buttonPrimaryBg,
                          },
                        ]}
                      >
                        <AppText variant="statPillLabel" tone="accentOn">
                          {isLinking
                            ? strings.linkingButton ?? strings.selectButton
                            : strings.selectButton}
                        </AppText>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          ) : null}
          <View
            style={[styles.actions, showNotFoundTips ? styles.actionsAfterTips : null]}
            onLayout={onActionsLayout}
          >
            {showRetryButton ? (
              <AppButton
                variant="primary"
                label={strings.retryButton}
                onPress={() => setScanAttempt((value) => value + 1)}
                style={{ width: equalButtonWidth, marginRight: ACTION_BUTTON_GAP }}
              />
            ) : null}
            <AppButton
              variant="secondary"
              label={strings.closeButton}
              onPress={onClose}
              disabled={Boolean(linkingId)}
              style={equalButtonWidth > 0 ? { width: equalButtonWidth } : undefined}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
  spinner: {
    alignSelf: "flex-start",
  },
  candidates: {
    gap: 10,
  },
  candidateCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
    gap: 10,
  },
  candidateText: {
    gap: 4,
  },
  selectButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  actions: {
    flexDirection: "row",
    alignSelf: "stretch",
  },
  actionsAfterTips: {
    marginTop: 12,
  },
  notFoundTips: {
    marginBottom: 0,
  },
});
