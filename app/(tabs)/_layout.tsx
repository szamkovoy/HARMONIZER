import React from "react";
import { Tabs } from "expo-router";

import { useAccess } from "@/modules/access";
import { useTranslate } from "@/modules/i18n";
import { TabBarIcon } from "@/modules/ui/TabBarIcon";
import {
  COMPACT_TAB_BAR_ITEM_STYLE,
  COMPACT_TAB_BAR_LABEL_STYLE,
  useCompactTabBarStyle,
} from "@/modules/ui/useCompactTabBarStyle";
import { useTheme } from "@/modules/ui/theme";

export default function TabLayout() {
  const theme = useTheme();
  const { t } = useTranslate();
  const { canUseFeature } = useAccess();
  const canOpenPractices = canUseFeature("practice_catalog");
  const canOpenDay = canUseFeature("day_planning");
  const tabBarStyle = useCompactTabBarStyle(theme.colors);

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
          href: canOpenPractices ? undefined : null,
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
        }}
      />
    </Tabs>
  );
}
