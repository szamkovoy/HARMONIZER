import { StyleSheet, View } from "react-native";

import { AppText } from "@/modules/ui/AppText";
import { SurfaceCardHelpButton } from "@/modules/ui/SurfaceCardHelpButton";
import type { SurfaceCardHelpConfig } from "@/modules/ui/SurfaceCardView";
import { SURFACE_CARD_HELP } from "@/modules/ui/surfaceCard";

/** Title line + optional help «?» — shared layout for surface-card headers. */
export function SurfaceCardTitleRow({
  title,
  help,
}: {
  title: string;
  help?: SurfaceCardHelpConfig;
}) {
  return (
    <View style={styles.row}>
      <AppText variant="sectionTitle" style={styles.title}>
        {title}
      </AppText>
      {help ? <SurfaceCardHelpButton accessibilityLabel={help.accessibilityLabel} onPress={help.onPress} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: SURFACE_CARD_HELP.titleLineHeight,
  },
  title: {
    flex: 1,
    flexShrink: 1,
  },
});
