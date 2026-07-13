import { useFocusEffect } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { DateTime } from "luxon";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useTranslate } from "@/modules/i18n";
import { fetchUpcomingWebinar, localizeWebinar, type WebinarItem } from "@/modules/webinars/core/webinarsClient";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

/** Анонс ближайшего вебинара на главной (до starts_at + 1 ч); null, если окна нет. */
export function UpcomingWebinarBanner() {
  const theme = useTheme();
  const { t, locale } = useTranslate();
  const [webinar, setWebinar] = useState<WebinarItem | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    void fetchUpcomingWebinar().then((item) => {
      if (!cancelled) setWebinar(item);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(reload);

  if (!webinar) return null;
  const localized = localizeWebinar(webinar, locale);

  const when = DateTime.fromISO(localized.startsAt).setLocale(locale).toLocaleString({
    day: "numeric",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("webinars.banner.a11y")}
      onPress={() => router.push(`/webinar/${webinar.id}` as Href)}
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
      <AppText variant="technicalCaption" tone="muted" numberOfLines={1} style={styles.text}>
        {when} · {t("webinars.banner.label")} · {localized.title}
      </AppText>
      <AppText variant="sectionTitle" tone="muted" style={styles.arrow}>
        ›
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
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
