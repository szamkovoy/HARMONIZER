import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { AppText } from "@/modules/ui/AppText";
import { ModalHeaderCloseButton } from "@/modules/ui/ModalHeaderCloseButton";
import { SURFACE_HELP_MODAL } from "@/modules/ui/surfaceCard";
import { textStyleFromToken, useTheme } from "@/modules/ui/theme";

export interface SurfaceHelpModalProps {
  visible: boolean;
  title: string;
  closeLabel: string;
  closeAccessibilityLabel?: string;
  onClose: () => void;
  loading?: boolean;
  loadingLabel?: string;
  /** Plain-text body when not loading. Ignored when `children` is set. */
  body?: string | null;
  children?: ReactNode;
}

function estimateBodyWidth(windowWidth: number): number {
  const cardWidth = Math.min(
    SURFACE_HELP_MODAL.cardMaxWidth,
    windowWidth - SURFACE_HELP_MODAL.backdropPadding * 2,
  );
  return cardWidth - SURFACE_HELP_MODAL.cardPadding * 2;
}

/**
 * Typified centered help modal for surface cards (triggered by the «?» icon).
 * Body width is measured in px — percentage widths inside RN Modal are unreliable on iOS.
 */
export function SurfaceHelpModal({
  visible,
  title,
  closeLabel,
  closeAccessibilityLabel,
  onClose,
  loading = false,
  loadingLabel,
  body,
  children,
}: SurfaceHelpModalProps) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [bodyWidth, setBodyWidth] = useState(() => estimateBodyWidth(windowWidth));
  const closeA11y = closeAccessibilityLabel ?? closeLabel;
  const bodyStyle = textStyleFromToken(theme.typography.screenHint, theme.colors.textPrimary);
  const paragraphs = body?.split(/\n\n+/).filter(Boolean) ?? [];

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop }]}>
        <View
          onLayout={(event) => {
            const measured =
              event.nativeEvent.layout.width - SURFACE_HELP_MODAL.cardPadding * 2;
            if (measured > 0) {
              setBodyWidth(Math.floor(measured));
            }
          }}
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
              borderRadius: theme.radius.lg,
            },
          ]}
        >
          <View style={[styles.headerRow, { marginTop: SURFACE_HELP_MODAL.titleOffsetTop }]}>
            <AppText variant="sectionTitle" style={styles.title}>
              {title}
            </AppText>
            <ModalHeaderCloseButton onPress={onClose} accessibilityLabel={closeA11y} />
          </View>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={theme.colors.accent} />
              {loadingLabel ? (
                <AppText variant="screenHint" tone="muted">
                  {loadingLabel}
                </AppText>
              ) : null}
            </View>
          ) : children ? (
            children
          ) : paragraphs.length > 0 ? (
            <View style={{ width: bodyWidth }}>
              {paragraphs.map((paragraph, index) => (
                <Text
                  key={index}
                  style={[
                    bodyStyle,
                    { width: bodyWidth },
                    index > 0 ? { marginTop: SURFACE_HELP_MODAL.bodyParagraphGap } : null,
                  ]}
                >
                  {paragraph}
                </Text>
              ))}
            </View>
          ) : null}
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.actionButton}>
              <AppText variant="buttonLabel">{closeLabel}</AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: SURFACE_HELP_MODAL.backdropPadding,
  },
  card: {
    borderWidth: 1,
    maxWidth: SURFACE_HELP_MODAL.cardMaxWidth,
    padding: SURFACE_HELP_MODAL.cardPadding,
    width: "100%",
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: SURFACE_HELP_MODAL.titleToBodyGap,
    minHeight: SURFACE_HELP_MODAL.titleLineHeight,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  loadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: SURFACE_HELP_MODAL.cardGap,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: SURFACE_HELP_MODAL.actionsMarginTop,
  },
  actionButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
