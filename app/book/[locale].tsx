import { Stack } from "expo-router";
import { Suspense, lazy } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { useTranslate } from "@/modules/i18n";

/**
 * Lazy-load the reader so `@epubjs-react-native/core` + EPUB asset stay out of
 * the cold-start bundle (sync import here caused a black screen hang).
 */
const BookReaderScreen = lazy(() =>
  import("@/modules/book/ui/BookReaderScreen").then((m) => ({
    default: m.BookReaderScreen,
  })),
);

function ReaderSuspenseFallback() {
  const { t } = useTranslate();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" }}>
      <ActivityIndicator />
      <Text style={{ marginTop: 12, color: "#666", fontSize: 15 }}>{t("book.reader.loading")}</Text>
    </View>
  );
}

export default function BookReaderRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          headerBackTitleVisible: false,
          headerBackTitle: "",
          animation: "slide_from_right",
          // Horizontal page turn must not trigger iOS interactive pop → Profile.
          gestureEnabled: false,
          fullScreenGestureEnabled: false,
        }}
      />
      <Suspense fallback={<ReaderSuspenseFallback />}>
        <BookReaderScreen />
      </Suspense>
    </>
  );
}
