import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { useAppLocale } from "@/modules/i18n";
import { getConnectTvStrings } from "@/modules/remote-play/i18n/remotePlay";
import { normalizePairingCode } from "@/modules/remote-play/core/types";
import { useRemotePlay } from "@/modules/remote-play/useRemotePlay";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { FloatingCloseButton } from "@/modules/ui/FloatingCloseButton";
import { ModalScreenLayout } from "@/modules/ui/StackScreenLayout";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";

const PIN_LEN = 4;

function charsFromNormalized(value: string): string[] {
  const clean = normalizePairingCode(value).slice(0, PIN_LEN);
  return Array.from({ length: PIN_LEN }, (_, index) => clean[index] ?? "");
}

export function ConnectTVScreen() {
  const theme = useTheme();
  const { locale } = useAppLocale();
  const strings = getConnectTvStrings(locale);
  const remotePlay = useRemotePlay();
  const params = useLocalSearchParams<{
    vimeoId?: string;
    title?: string;
    durationSec?: string;
    audiotrack?: string;
    practiceId?: string;
    slug?: string;
    chakraIds?: string;
    launchSource?: string;
  }>();
  const pendingVimeoId =
    typeof params.vimeoId === "string" && params.vimeoId.trim() ? params.vimeoId.trim() : null;
  const [launching, setLaunching] = useState(false);
  const [cells, setCells] = useState<string[]>(() => Array.from({ length: PIN_LEN }, () => ""));
  const [focusedPinIndex, setFocusedPinIndex] = useState<number | null>(null);
  const inputRefs = useRef<Array<TextInput | null>>([]);

  const joined = normalizePairingCode(cells.join(""));
  const canSubmit = joined.length === PIN_LEN && !remotePlay.busy;

  useEffect(() => {
    if (remotePlay.connected && remotePlay.session?.pairing_code) {
      setCells(charsFromNormalized(remotePlay.session.pairing_code));
    }
  }, [remotePlay.connected, remotePlay.session?.pairing_code]);

  const focusCell = (index: number) => {
    const target = Math.max(0, Math.min(index, PIN_LEN - 1));
    inputRefs.current[target]?.focus();
  };

  const submit = async () => {
    if (!canSubmit) return;
    try {
      const row = await remotePlay.linkDevice(joined);
      setCells(charsFromNormalized(row.pairing_code));
    } catch {
      /* Error shown via remotePlay.error */
    }
  };

  const handleChangeText = (index: number, text: string) => {
    remotePlay.clearError();
    const normalized = normalizePairingCode(text);
    if (!normalized.length) {
      const next = [...cells];
      next[index] = "";
      setCells(next);
      return;
    }
    if (normalized.length === 1) {
      const next = [...cells];
      next[index] = normalized;
      setCells(next);
      if (index < PIN_LEN - 1) focusCell(index + 1);
      return;
    }

    const distributed = charsFromNormalized(normalized);
    setCells(distributed);
    const filled = normalized.length >= PIN_LEN ? PIN_LEN - 1 : Math.min(normalized.length, PIN_LEN - 1);
    focusCell(filled);
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key !== "Backspace") return;
    if (cells[index]) return;
    if (index > 0) {
      focusCell(index - 1);
      const next = [...cells];
      next[index - 1] = "";
      setCells(next);
    }
  };

  const showLinkedLine = remotePlay.connected && !remotePlay.error;
  const close = () => router.back();

  const startPractice = async () => {
    if (!pendingVimeoId || !remotePlay.connected || launching) return;
    setLaunching(true);
    try {
      await remotePlay.playVimeo(pendingVimeoId, params.audiotrack);
      router.replace({
        pathname: "/tv-remote",
        params: {
          title: typeof params.title === "string" ? params.title : "",
          durationSec: typeof params.durationSec === "string" ? params.durationSec : "",
          vimeoId: pendingVimeoId,
          audiotrack: typeof params.audiotrack === "string" ? params.audiotrack : "",
          practiceId: typeof params.practiceId === "string" ? params.practiceId : "",
          slug: typeof params.slug === "string" ? params.slug : "",
          chakraIds: typeof params.chakraIds === "string" ? params.chakraIds : "",
          launchSource: typeof params.launchSource === "string" ? params.launchSource : "",
        },
      });
    } catch (error) {
      setLaunching(false);
      Alert.alert(
        "Remote Play",
        error instanceof Error ? error.message : strings.description,
      );
    }
  };

  return (
    <ModalScreenLayout
      keyboard
      overlay={
        <FloatingCloseButton
          accessibilityLabel={strings.closeA11y}
          onPress={() => router.back()}
        />
      }
    >
      <SurfaceCardView tone="elevated" style={styles.card}>
        <View style={styles.centerBlock}>
          <AppText variant="screenTitle" accessibilityRole="header" style={styles.centerText}>
            {strings.title}
          </AppText>
          <AppText variant="screenHint" tone="muted" style={styles.hint}>
            {strings.description}
          </AppText>

          <View style={styles.pinRow}>
            {cells.map((value, index) => (
              <TextInput
                key={index}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                value={value ? normalizePairingCode(value) : ""}
                onChangeText={(text) => handleChangeText(index, text)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent.key)}
                onFocus={() => setFocusedPinIndex(index)}
                onBlur={() =>
                  setFocusedPinIndex((current) => (current === index ? null : current))
                }
                autoCapitalize="characters"
                autoCorrect={false}
                keyboardType="ascii-capable"
                maxLength={1}
                returnKeyType="done"
                placeholder={focusedPinIndex === index ? "" : "—"}
                placeholderTextColor={theme.colors.textFaint}
                style={[
                  styles.pinCell,
                  {
                    borderColor: remotePlay.error ? theme.colors.warning : theme.colors.surfaceBorder,
                    color: theme.colors.textPrimary,
                    backgroundColor: theme.colors.controlButtonBg,
                  },
                ]}
              />
            ))}
          </View>

          {remotePlay.busy || launching ? <ActivityIndicator color={theme.colors.accent} /> : null}

          {remotePlay.error ? (
            <AppText variant="dialogBody" tone="warning" style={styles.feedback}>
              {remotePlay.error}
            </AppText>
          ) : showLinkedLine ? (
            <AppText variant="sectionTitle" tone="accent" style={styles.feedback}>
              {strings.linked}
            </AppText>
          ) : null}

          <View style={styles.actions}>
            {showLinkedLine ? (
              pendingVimeoId ? (
                <AppButton
                  label={strings.startPracticeButton}
                  onPress={startPractice}
                  disabled={launching}
                />
              ) : (
                <AppButton label={strings.closeButton} onPress={close} />
              )
            ) : (
              <AppButton
                label={strings.submitButton}
                onPress={submit}
                disabled={!canSubmit}
              />
            )}
          </View>
        </View>
      </SurfaceCardView>
    </ModalScreenLayout>
  );
}

const styles = StyleSheet.create({
  card: {
    maxWidth: 390,
    width: "100%",
  },
  centerBlock: {
    alignItems: "center",
    gap: 14,
  },
  centerText: {
    textAlign: "center",
    width: "100%",
  },
  hint: {
    textAlign: "center",
  },
  pinRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  pinCell: {
    width: 54,
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
    ...Platform.select({
      android: { includeFontPadding: false },
      default: {},
    }),
  },
  feedback: {
    textAlign: "center",
    width: "100%",
  },
  feedbackLinked: {
    textAlign: "center",
    width: "100%",
  },
  actions: {
    width: "100%",
    gap: 10,
    marginTop: 4,
  },
});
