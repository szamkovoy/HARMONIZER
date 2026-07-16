/**
 * GeoGate: жёсткий экран-гейт на главной странице.
 *
 * Если foreground-доступ к геолокации отсутствует или отозван (пользователь
 * выключил его в настройках системы) — главный экран не показывается.
 * Вместо него рисуется поясняющая карточка с двумя путями:
 *   • разрешить геолокацию (или открыть настройки, если повторный запрос
 *     уже бесполезен — `canAskAgain === false`);
 *   • закрыть приложение — естественный выход, чтобы не зацикливать
 *     пользователя в гейте, если он не хочет давать доступ.
 *
 * Гейт проверяет разрешение на монтировании и каждый раз, когда приложение
 * возвращается на экран (AppState → "active") — это покрывает случай, когда
 * пользователь разрешает геолокацию в системных настройках и возвращается.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, Linking, StyleSheet, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import * as Location from "expo-location";

import { useTranslate } from "@/modules/i18n";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

type GateStatus = "checking" | "granted" | "denied";

const GATE_SAFE_EDGES: Edge[] = ["top", "left", "right"];

export interface GeoGateProps {
  children: ReactNode;
  /** Вызывается, когда пользователь решает прервать ожидание и выйти. */
  onCloseApp: () => void;
  /** Вызывается однократно при переходе разрешения в "granted" — чтобы
   *  родитель мог перезапустить загрузку контента дня. */
  onGranted?: () => void;
}

export function GeoGate({ children, onCloseApp, onGranted }: GeoGateProps) {
  const { t } = useTranslate();
  const theme = useTheme();
  const [status, setStatus] = useState<GateStatus>("checking");
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [busy, setBusy] = useState(false);
  const prevStatusRef = useRef<GateStatus>("checking");

  const check = useCallback(async () => {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status === "granted") {
      setStatus("granted");
    } else {
      setStatus("denied");
      setCanAskAgain(perm.canAskAgain !== false);
    }
  }, []);

  useEffect(() => {
    void check();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => sub.remove();
  }, [check]);

  // Сообщаем родителю о свежем "granted" — единственный момент, когда имеет
  // смысл перезапрашивать дневной контент (до этого геолокации не было).
  useEffect(() => {
    if (prevStatusRef.current !== "granted" && status === "granted") {
      onGranted?.();
    }
    prevStatusRef.current = status;
  }, [status, onGranted]);

  const handleGrant = useCallback(async () => {
    setBusy(true);
    logRuntimeEvent("location:gate_request", {});
    const perm = await Location.requestForegroundPermissionsAsync();
    logRuntimeEvent("location:gate_result", { status: perm.status, canAskAgain: perm.canAskAgain });
    setBusy(false);
    if (perm.status === "granted") {
      setStatus("granted");
    } else {
      setStatus("denied");
      setCanAskAgain(perm.canAskAgain !== false);
    }
  }, []);

  if (status === "granted") return <>{children}</>;

  if (status === "checking") {
    return (
      <SafeAreaView edges={GATE_SAFE_EDGES} style={[styles.root, { backgroundColor: theme.colors.screenBg }]}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={GATE_SAFE_EDGES} style={[styles.root, { backgroundColor: theme.colors.screenBg }]}>
      <View style={styles.card}>
        <AppText variant="sectionTitle" style={styles.title}>
          {t("home.geoGate.title")}
        </AppText>
        <AppText variant="dialogBody" tone="muted" style={styles.body}>
          {t("home.geoGate.message")}
        </AppText>

        <AppButton
          label={busy ? "…" : t("home.geoGate.grantButton")}
          onPress={() => void handleGrant()}
          disabled={busy}
        />
        {canAskAgain ? null : (
          <AppButton
            label={t("home.geoGate.openSettings")}
            variant="secondary"
            onPress={() => void Linking.openSettings()}
          />
        )}
        <AppButton
          label={t("home.geoGate.closeApp")}
          variant="secondary"
          onPress={onCloseApp}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    alignSelf: "stretch",
    maxWidth: 460,
    width: "100%",
    gap: 14,
    alignItems: "center",
  },
  title: {
    textAlign: "center",
  },
  body: {
    textAlign: "center",
  },
});
