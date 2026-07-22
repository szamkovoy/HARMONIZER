import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  type KeyboardEvent,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppLocale } from "@/modules/i18n";
import { vimeoAudiotrackForLocale } from "@/modules/practices/core/vimeo";
import { getConnectTvStrings } from "@/modules/remote-play/i18n/remotePlay";
import { normalizePairingCode } from "@/modules/remote-play/core/types";
import { useRemotePlay } from "@/modules/remote-play/useRemotePlay";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { FloatingCloseButton } from "@/modules/ui/FloatingCloseButton";
import { StackScreenLayout } from "@/modules/ui/StackScreenLayout";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";

const PIN_LEN = 4;

function charsFromNormalized(value: string): string[] {
  const clean = normalizePairingCode(value).slice(0, PIN_LEN);
  return Array.from({ length: PIN_LEN }, (_, index) => clean[index] ?? "");
}

export function ConnectTVScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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
  const scrollRef = useRef<ScrollView>(null);
  /** Same pattern as onboarding WizardShell: lift content above Android IME. */
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);
  const keyboardOpenRef = useRef(false);

  const joined = normalizePairingCode(cells.join(""));
  const canSubmit = joined.length === PIN_LEN && !remotePlay.busy;

  useEffect(() => {
    if (remotePlay.connected && remotePlay.session?.pairing_code) {
      setCells(charsFromNormalized(remotePlay.session.pairing_code));
    }
  }, [remotePlay.connected, remotePlay.session?.pairing_code]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = (event: KeyboardEvent) => {
      if (Platform.OS === "android") {
        setAndroidKeyboardHeight(Math.max(0, event.endCoordinates?.height ?? 0));
      }
      const firstOpen = !keyboardOpenRef.current;
      if (firstOpen) {
        keyboardOpenRef.current = true;
        setKeyboardOpen(true);
      }
      if (firstOpen && Platform.OS === "ios") {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollToEnd({ animated: false });
        });
      }
    };

    const onHide = () => {
      keyboardOpenRef.current = false;
      setKeyboardOpen(false);
      setAndroidKeyboardHeight(0);
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (!keyboardOpen || androidKeyboardHeight < 1) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const scrollToFooter = () => {
      if (!cancelled) scrollRef.current?.scrollToEnd({ animated: false });
    };
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToFooter();
        retryTimer = setTimeout(scrollToFooter, 48);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [keyboardOpen, androidKeyboardHeight]);

  const rootPaddingBottom = keyboardOpen
    ? Platform.OS === "android"
      ? Math.max(androidKeyboardHeight, 8)
      : 8
    : Math.max(insets.bottom, 12);

  const focusCell = (index: number) => {
    const target = Math.max(0, Math.min(index, PIN_LEN - 1));
    inputRefs.current[target]?.focus();
  };

  const submit = async () => {
    if (!canSubmit) return;
    try {
      const row = await remotePlay.linkDevice(joined);
      setCells(charsFromNormalized(row.pairing_code));
      Keyboard.dismiss();
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
    const audiotrack =
      typeof params.audiotrack === "string" && params.audiotrack.trim()
        ? params.audiotrack.trim()
        : vimeoAudiotrackForLocale(locale);
    try {
      await remotePlay.playVimeo(pendingVimeoId, audiotrack);
      router.replace({
        pathname: "/tv-remote",
        params: {
          title: typeof params.title === "string" ? params.title : "",
          durationSec: typeof params.durationSec === "string" ? params.durationSec : "",
          vimeoId: pendingVimeoId,
          audiotrack,
          practiceId: typeof params.practiceId === "string" ? params.practiceId : "",
          slug: typeof params.slug === "string" ? params.slug : "",
          chakraIds: typeof params.chakraIds === "string" ? params.chakraIds : "",
          launchSource: typeof params.launchSource === "string" ? params.launchSource : "",
        },
      });
    } catch (error) {
      setLaunching(false);
      Alert.alert(
        strings.title,
        error instanceof Error ? error.message : strings.description,
      );
    }
  };

  return (
    <StackScreenLayout statusBarStyle="light" edges={["top"]}>
      <FloatingCloseButton
        accessibilityLabel={strings.closeA11y}
        onPress={() => router.back()}
      />
      <View style={[styles.root, { paddingBottom: rootPaddingBottom }]}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          showsVerticalScrollIndicator={false}
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
                        borderColor: remotePlay.error
                          ? theme.colors.warning
                          : theme.colors.surfaceBorder,
                        color: theme.colors.textPrimary,
                        backgroundColor: theme.colors.controlButtonBg,
                      },
                    ]}
                  />
                ))}
              </View>

              {remotePlay.busy || launching ? (
                <ActivityIndicator color={theme.colors.accent} />
              ) : null}

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
        </ScrollView>
      </View>
    </StackScreenLayout>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 24,
  },
  card: {
    maxWidth: 390,
    width: "100%",
    alignSelf: "center",
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
  actions: {
    width: "100%",
    gap: 10,
    marginTop: 4,
  },
});
