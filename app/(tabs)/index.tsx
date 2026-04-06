import { Communicator } from "@/modules/communicator/ui/Communicator";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

export default function CommunicatorScreen() {
  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <Pressable
        onPress={() => router.push("/mandala-sandbox")}
        style={{
          position: "absolute",
          top: 56,
          right: 16,
          zIndex: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: "#0f172f",
        }}
      >
        <Text style={{ color: "#eef2ff", fontWeight: "600" }}>Mandala Sandbox</Text>
      </Pressable>
      <Communicator
        systemPrompt="Ты эмпатичный наставник приложения Harmonizer. Отвечай кратко и по делу."
        memoryWindow={24}
      />
    </View>
  );
}
