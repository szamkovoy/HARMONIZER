import { Fragment, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { AppText } from "@/modules/ui/AppText";

interface MarkdownTextProps {
  source: string;
}

function inlineMarkdown(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    const bold = part.startsWith("**") && part.endsWith("**");
    return (
      <AppText key={`${part}-${index}`} style={bold ? styles.bold : undefined}>
        {bold ? part.slice(2, -2) : part}
      </AppText>
    );
  });
}

export function MarkdownText({ source }: MarkdownTextProps) {
  const lines = source.trim().split(/\r?\n/);
  return (
    <View style={styles.root}>
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <View key={`blank-${index}`} style={styles.blank} />;
        if (line.startsWith("### ")) {
          return (
            <AppText key={`h3-${index}`} variant="sectionTitle" style={styles.heading}>
              {line.slice(4)}
            </AppText>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <AppText key={`h2-${index}`} variant="dialogTitle" style={styles.heading}>
              {line.slice(3)}
            </AppText>
          );
        }
        if (line.startsWith("- ")) {
          return (
            <View key={`li-${index}`} style={styles.listRow}>
              <AppText tone="muted">•</AppText>
              <AppText variant="screenHint" tone="muted" style={styles.listText}>
                {inlineMarkdown(line.slice(2))}
              </AppText>
            </View>
          );
        }
        return (
          <AppText key={`p-${index}`} variant="screenHint" tone="muted">
            {inlineMarkdown(line)}
          </AppText>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 8,
  },
  heading: {
    marginTop: 4,
  },
  blank: {
    height: 6,
  },
  listRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  listText: {
    flex: 1,
  },
  bold: {
    fontWeight: "700",
  },
});
