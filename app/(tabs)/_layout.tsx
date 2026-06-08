import React from "react";
import { Tabs } from "expo-router";

import { useAccess } from "@/modules/access";
import { useTheme } from "@/modules/ui/theme";

export default function TabLayout() {
  const theme = useTheme();
  const { canUseFeature } = useAccess();
  const canOpenPractices = canUseFeature("practice_catalog");
  const canOpenDay = canUseFeature("day_planning");

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textFaint,
        tabBarStyle: {
          backgroundColor: theme.colors.surfaceElevated,
          borderTopColor: theme.colors.surfaceBorder,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarLabel: "Home" }} />
      <Tabs.Screen
        name="day"
        options={{
          title: "День",
          tabBarLabel: "День",
          href: canOpenDay ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="practices"
        options={{
          title: "Практики",
          tabBarLabel: "Практики",
          href: canOpenPractices ? undefined : null,
        }}
      />
      <Tabs.Screen name="profile" options={{ title: "Профиль", tabBarLabel: "Профиль" }} />
    </Tabs>
  );
}
