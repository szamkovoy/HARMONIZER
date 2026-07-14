import { useFocusEffect } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { DateTime } from "luxon";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useTranslate } from "@/modules/i18n";
import { fetchWebinars, localizeWebinar, type WebinarItem } from "@/modules/webinars/core/webinarsClient";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

/**
 * Компактный блок анонсов вебинаров для вкладки «Видео»: только join-окно.
 * Опубликованные записи живут в общей ленте постов как обычные VideoCard.
 */
export function WebinarsStrip() {
  const theme = useTheme();
  const { t, locale } = useTranslate();
  const [upcoming, setUpcoming] = useState<WebinarItem[] | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    void fetchWebinars().then((result) => {
      if (!cancelled) setUpcoming(result.upcoming);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(reload);

  if (!upcoming || upcoming.length === 0) return null;

  return (
    <View style={styles.root}>
      <AppText variant="sectionTitle">{t("webinars.strip.title")}</AppText>
      {upcoming.map((webinar) => {
        const localized = localizeWebinar(webinar, locale);
        if (!localized) return null;
        return (
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
                {localized.title}
              </AppText>
              <AppText variant="technicalCaption" tone="accent">
                {DateTime.fromISO(localized.startsAt)
                  .setLocale(locale)
                  .toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY)}
              </AppText>
            </View>
            <AppText variant="sectionTitle" tone="muted">
              ›
            </AppText>
          </Pressable>
        );
      })}
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
