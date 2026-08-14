import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Pressable, StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";

import { AccountGateDialog, useAccess } from "@/modules/access";
import {
  fetchActiveAffirmation,
  type AffirmationDto,
} from "@/modules/affirmations/core/affirmationsClient";
import { useTranslate } from "@/modules/i18n";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

/**
 * Practices catalog entry: add affirmation or open active day counter.
 * Master-only soft gate (breath-practices tone).
 */
export function AffirmationWidget() {
  const theme = useTheme();
  const { t } = useTranslate();
  const { canUseFeature } = useAccess();
  const [affirmation, setAffirmation] = useState<AffirmationDto | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  /** In-flight GET so a tap before cache resolve still routes correctly — never dim/disable the banner. */
  const fetchRef = useRef<Promise<AffirmationDto | null> | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const p = fetchActiveAffirmation()
        .then((row) => {
          if (!cancelled) setAffirmation(row);
          return row;
        })
        .catch(() => {
          if (!cancelled) setAffirmation(null);
          return null;
        })
        .finally(() => {
          if (fetchRef.current === p) fetchRef.current = null;
        });
      fetchRef.current = p;
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const onPress = () => {
    if (!canUseFeature("affirmations")) {
      setGateOpen(true);
      return;
    }
    void (async () => {
      let row = affirmation;
      if (fetchRef.current) {
        try {
          row = await fetchRef.current;
        } catch {
          row = affirmation;
        }
      }
      if (row) {
        router.push("/affirmation/manage" as Href);
      } else {
        router.push("/affirmation/create" as Href);
      }
    })();
  };

  const displayLabel = affirmation
    ? t("affirmation.widget.active", { day: Math.max(1, affirmation.currentDay || 1) })
    : t("affirmation.widget.add");
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("affirmation.widget.a11y")}
        onPress={onPress}
        style={({ pressed }) => [
          styles.banner,
          {
            backgroundColor: theme.colors.controlButtonBg,
            borderColor: theme.colors.surfaceBorder,
            opacity: pressed ? 0.72 : 1,
          },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: theme.colors.accent }]} />
        <AppText variant="screenHint" tone="muted" numberOfLines={2} style={styles.text}>
          {displayLabel}
        </AppText>
        <AppText variant="screenHint" tone="muted" style={styles.arrow}>
          ›
        </AppText>
      </Pressable>
      <AccountGateDialog
        visible={gateOpen}
        feature="affirmations"
        onClose={() => setGateOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  text: {
    flex: 1,
  },
  arrow: {
    marginTop: -2,
  },
});
