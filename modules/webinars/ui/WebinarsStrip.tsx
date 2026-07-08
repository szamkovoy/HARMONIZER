import { useFocusEffect } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { DateTime } from "luxon";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useTranslate } from "@/modules/i18n";
import { fetchWebinars, type WebinarItem } from "@/modules/webinars/core/webinarsClient";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

const MAX_PAST = 5;

/**
 * Компактный блок вебинаров для вкладки «Публикации»: предстоящие
 * + последние прошедшие с записью. Null, когда показывать нечего.
 */
export function WebinarsStrip() {
  const theme = useTheme();
  const { t, locale } = useTranslate();
  const [items, setItems] = useState<{ upcoming: WebinarItem[]; past: WebinarItem[] } | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    void fetchWebinars().then((result) => {
      if (!cancelled) setItems(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(reload);

  if (!items || (items.upcoming.length === 0 && items.past.length === 0)) return null;

  const rows = [
    ...items.upcoming.map((w) => ({ webinar: w, isPast: false })),
    ...items.past.slice(0, MAX_PAST).map((w) => ({ webinar: w, isPast: true })),
  ];

  return (
    <View style={styles.root}>
      <AppText variant="sectionTitle">{t("webinars.strip.title")}</AppText>
      {rows.map(({ webinar, isPast }) => (
        <Pressable
          key={webinar.id}
          accessibilityRole="button"
          onPress={() => router.push(`/webinar/${webinar.id}` as Href)}
          style={({ pressed }) => [
            styles.row,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View style={styles.rowBody}>
            <AppText variant="buttonLabel" numberOfLines={1}>
              {webinar.title}
            </AppText>
            <AppText variant="technicalCaption" tone={isPast ? "faint" : "accent"}>
              {isPast
                ? t("webinars.strip.recording")
                : DateTime.fromISO(webinar.startsAt)
                    .setLocale(locale)
                    .toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY)}
            </AppText>
          </View>
          <AppText variant="sectionTitle" tone="muted">
            ›
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 10,
  },
  row: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
});
