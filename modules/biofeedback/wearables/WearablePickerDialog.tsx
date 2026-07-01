import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from "react-native";

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
  notFoundHint: string;
  notFoundTips?: string;
  bluetoothOffHint: string;
  retryButton: string;
  closeButton: string;
  selectButton: string;
  signalLabel: string;
  bluetoothStateLabel: string;
}

export function WearablePickerDialog({
  visible,
  strings,
  onClose,
  onSelect,
  alertMessage,
}: {
  visible: boolean;
  strings: WearablePickerDialogStrings;
  onClose: () => void;
  onSelect: (candidate: WearableScanCandidate) => void;
  alertMessage?: string | null;
}) {
  const theme = useTheme();
  const { bluetoothState, scanState, scanError, devices: scannedWearables, startScan, stopScan } =
    useWearableScanner();
  const [scanAttempt, setScanAttempt] = useState(0);
  const [searchFinished, setSearchFinished] = useState(false);
  const scanStartedAtMsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) {
      setSearchFinished(false);
      scanStartedAtMsRef.current = null;
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

  const bodyMessage =
    bluetoothState !== "PoweredOn"
      ? strings.bluetoothOffHint
      : scannedWearables.length
        ? strings.foundHint
        : searchFinished
          ? strings.notFoundHint
          : strings.searchHint;
  const showNotFoundTips =
    searchFinished && scannedWearables.length === 0 && strings.notFoundTips != null;
  const showRetryButton =
    showNotFoundTips && bluetoothState === "PoweredOn" && scanState !== "scanning";

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
          {scanError ? (
            <AppText variant="dialogBody" tone="muted">
              {scanError}
            </AppText>
          ) : null}
          {scanState === "scanning" ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
          ) : null}
          {scannedWearables.length ? (
            <View style={styles.candidates}>
              {scannedWearables.slice(0, 6).map((candidate) => (
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
                      {candidate.rssi != null
                        ? `${strings.signalLabel} ${candidate.rssi}`
                        : `${strings.bluetoothStateLabel}: ${bluetoothState}`}
                    </AppText>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onSelect(candidate)}
                    style={({ pressed }) => [
                      styles.selectButton,
                      {
                        backgroundColor: pressed ? theme.colors.controlButtonPressedBg : theme.colors.buttonPrimaryBg,
                      },
                    ]}
                  >
                    <AppText variant="statPillLabel" tone="accentOn">
                      {strings.selectButton}
                    </AppText>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          <View style={[styles.actions, showNotFoundTips ? styles.actionsAfterTips : null]}>
            {showRetryButton ? (
              <View style={styles.actionButtonWrap}>
                <AppButton
                  variant="primary"
                  label={strings.retryButton}
                  onPress={() => setScanAttempt((value) => value + 1)}
                  style={styles.actionButtonFill}
                />
              </View>
            ) : null}
            <View style={showRetryButton ? styles.actionButtonWrap : undefined}>
              <AppButton
                variant="secondary"
                label={strings.closeButton}
                onPress={onClose}
                style={showRetryButton ? styles.actionButtonFill : styles.actionButtonSolo}
              />
            </View>
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
    gap: 8,
    flexWrap: "nowrap",
  },
  actionsAfterTips: {
    marginTop: 12,
  },
  notFoundTips: {
    marginBottom: 0,
  },
  actionButtonWrap: {
    flex: 1,
    minWidth: 0,
  },
  actionButtonFill: {
    width: "100%",
  },
  actionButtonSolo: {
    alignSelf: "flex-start",
    minWidth: 140,
  },
});
