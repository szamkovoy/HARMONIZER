import React, { useEffect } from "react";
import { Tabs } from "expo-router";

import { useAccess } from "@/modules/access";
import { useAuth } from "@/modules/auth";
import { useAppLocale, useTranslate } from "@/modules/i18n";
import { TabBarIcon } from "@/modules/ui/TabBarIcon";
import {
  COMPACT_TAB_BAR_ITEM_STYLE,
  COMPACT_TAB_BAR_LABEL_STYLE,
  useCompactTabBarStyle,
} from "@/modules/ui/useCompactTabBarStyle";
import { useTheme } from "@/modules/ui/theme";
import { ensureDayPlanPrefetch } from "@/services/dayPlanPrefetch";

export default function TabLayout() {
  const theme = useTheme();
  const { t } = useTranslate();
  const { authUser } = useAuth();
  const { locale } = useAppLocale();
  const { canUseFeature } = useAccess();
  const canOpenDay = canUseFeature("day_planning");
  const tabBarStyle = useCompactTabBarStyle(theme.colors);

  // Do not wait for Home forecast ready — Day tab can be opened first on Android.
  useEffect(() => {
    if (!canOpenDay || !authUser?.id) return;
    ensureDayPlanPrefetch({ userId: authUser.id, locale, reason: "tabs_mount" });
  }, [authUser?.id, canOpenDay, locale]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textFaint,
        sceneStyle: { backgroundColor: theme.colors.screenBg },
        tabBarStyle,
        tabBarAllowFontScaling: false,
        tabBarLabelStyle: COMPACT_TAB_BAR_LABEL_STYLE,
        tabBarItemStyle: COMPACT_TAB_BAR_ITEM_STYLE,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.home"),
          tabBarLabel: t("tabs.home"),
          tabBarIcon: ({ color }) => <TabBarIcon name="navigator" color={color} />,
        }}
      />
      <Tabs.Screen
        name="day"
        options={{
          title: t("tabs.day"),
          tabBarLabel: t("tabs.day"),
          tabBarIcon: ({ color }) => <TabBarIcon name="day" color={color} />,
          href: canOpenDay ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="practices"
        options={{
          title: t("tabs.practices"),
          tabBarLabel: t("tabs.practices"),
          tabBarIcon: ({ color }) => <TabBarIcon name="practices" color={color} />,
          // Каталог виден всем уровням — гейт стоит на «Начать практику»
          // внутри PracticeCatalogScreen (комплаенс-модель «Мастер»).
          href: undefined,
        }}
      />
      <Tabs.Screen
        name="posts"
        options={{
          title: t("tabs.posts"),
          tabBarLabel: t("tabs.posts"),
          tabBarIcon: ({ color }) => <TabBarIcon name="video" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("tabs.profile"),
          tabBarLabel: t("tabs.profile"),
          tabBarIcon: ({ color }) => <TabBarIcon name="profile" color={color} />,
          // Always visible for all tiers (unlike day/practices).
          href: undefined,
        }}
      />
    </Tabs>
  );
}
