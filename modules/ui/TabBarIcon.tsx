import { Image, type ImageSourcePropType } from "react-native";

const TAB_BAR_ICON_SIZE = 24;

const TAB_ICONS = {
  navigator: require("@/assets/icons/navigator.png"),
  day: require("@/assets/icons/day.png"),
  practices: require("@/assets/icons/practices.png"),
  publications: require("@/assets/icons/publications.png"),
  profile: require("@/assets/icons/profile.png"),
} as const satisfies Record<string, ImageSourcePropType>;

export type TabBarIconName = keyof typeof TAB_ICONS;

export function TabBarIcon({ name, color }: { name: TabBarIconName; color: string }) {
  return (
    <Image
      source={TAB_ICONS[name]}
      style={{ width: TAB_BAR_ICON_SIZE, height: TAB_BAR_ICON_SIZE, tintColor: color }}
      resizeMode="contain"
    />
  );
}
