import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
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
 * Help modal for surface cards (triggered by the «?» icon).
 * Card stays within the viewport (`maxHeight`); body scrolls from the top so
 * long copy / large Dynamic Type never clips the opening lines.
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [bodyWidth, setBodyWidth] = useState(() => estimateBodyWidth(windowWidth));
  const [headerHeight, setHeaderHeight] = useState(0);
  const [actionsHeight, setActionsHeight] = useState(0);
  const closeA11y = closeAccessibilityLabel ?? closeLabel;
  const bodyStyle = textStyleFromToken(theme.typography.screenHint, theme.colors.textPrimary);
  // Typed overlays sometimes store literal `\n` sequences from LLM fill;
  // normalize before splitting so all 8 locales get the same paragraph gaps.
  const paragraphs =
    body?.replace(/\\n/g, "\n").split(/\n\n+/).filter(Boolean) ?? [];

  const cardMaxHeight = Math.round(
    windowHeight * SURFACE_HELP_MODAL.cardMaxHeightFraction -
      SURFACE_HELP_MODAL.backdropPadding * 2,
  );
  // onLayout heights exclude margins on the measured views — subtract those gaps explicitly.
  const bodyMaxHeight = Math.max(
    SURFACE_HELP_MODAL.bodyMinHeight,
    cardMaxHeight -
      headerHeight -
      actionsHeight -
      SURFACE_HELP_MODAL.cardPadding * 2 -
      SURFACE_HELP_MODAL.titleOffsetTop -
      SURFACE_HELP_MODAL.titleToBodyGap -
      SURFACE_HELP_MODAL.actionsMarginTop,
  );

  useEffect(() => {
    if (!visible) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [visible, body, children, loading]);

  const bodyContent = loading ? (
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
  ) : null;

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
              maxHeight: cardMaxHeight,
            },
          ]}
        >
          <View
            onLayout={(event) => {
              const next = Math.ceil(event.nativeEvent.layout.height);
              if (next > 0 && next !== headerHeight) {
                setHeaderHeight(next);
              }
            }}
            style={[styles.headerRow, { marginTop: SURFACE_HELP_MODAL.titleOffsetTop }]}
          >
            <AppText variant="sectionTitle" style={styles.title}>
              {title}
            </AppText>
            <ModalHeaderCloseButton onPress={onClose} accessibilityLabel={closeA11y} />
          </View>
          {bodyContent != null ? (
            <ScrollView
              ref={scrollRef}
              style={[styles.bodyScroll, { maxHeight: bodyMaxHeight }]}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator
              bounces
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {bodyContent}
            </ScrollView>
          ) : null}
          <View
            onLayout={(event) => {
              const next = Math.ceil(event.nativeEvent.layout.height);
              if (next > 0 && next !== actionsHeight) {
                setActionsHeight(next);
              }
            }}
            style={styles.actions}
          >
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
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    flexGrow: 0,
    paddingBottom: 2,
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
