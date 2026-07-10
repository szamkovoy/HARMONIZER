import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { SurfaceCardTitleRow } from "@/modules/ui/SurfaceCardTitleRow";
import type { SurfaceCardHelpConfig } from "@/modules/ui/SurfaceCardView";
import { SURFACE_CARD } from "@/modules/ui/surfaceCard";

/** Title row + optional subtitle / first body line — shared header stack for surface cards. */
export function SurfaceCardHeader({
  title,
  help,
  children,
}: {
  title: string;
  help?: SurfaceCardHelpConfig;
  children?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <SurfaceCardTitleRow title={title} help={help} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: SURFACE_CARD.titleToContentGap,
  },
});
