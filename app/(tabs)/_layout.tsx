import React from "react";
import { Tabs } from "expo-router";

import { useAccess } from "@/modules/access";
import { useTranslate } from "@/modules/i18n";
import { useTheme } from "@/modules/ui/theme";

export default function TabLayout() {
  const theme = useTheme();
  const { t, locale } = useTranslate();
  const { canUseFeature } = useAccess();
  const canOpenPractices = canUseFeature("practice_catalog");
  const canOpenDay = canUseFeature("day_planning");

  return (
    <Tabs
      key={locale}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textFaint,
        sceneStyle: { backgroundColor: theme.colors.screenBg },
        tabBarStyle: {
          backgroundColor: theme.colors.surfaceElevated,
          borderTopColor: theme.colors.surfaceBorder,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabs.home"), tabBarLabel: t("tabs.home") }} />
      <Tabs.Screen
        name="day"
        options={{
          title: t("tabs.day"),
          tabBarLabel: t("tabs.day"),
          href: canOpenDay ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="practices"
        options={{
          title: t("tabs.practices"),
          tabBarLabel: t("tabs.practices"),
          href: canOpenPractices ? undefined : null,
        }}
      />
      <Tabs.Screen name="posts" options={{ title: t("tabs.posts"), tabBarLabel: t("tabs.posts") }} />
      <Tabs.Screen name="profile" options={{ title: t("tabs.profile"), tabBarLabel: t("tabs.profile") }} />
    </Tabs>
  );
}
