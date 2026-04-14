import { Communicator } from "@/modules/communicator/ui/Communicator";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

export default function CommunicatorScreen() {
  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <Pressable
        onPress={() => router.push("/biofeedback-probe")}
        style={{
          position: "absolute",
          top: 56,
          left: 16,
          zIndex: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: "#13231b",
        }}
      >
        <Text style={{ color: "#e4fff1", fontWeight: "600" }}>Biofeedback Probe</Text>
      </Pressable>
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
      <Pressable
        onPress={() => router.push("/bindu-succession-lab")}
        style={{
          position: "absolute",
          top: 108,
          right: 16,
          zIndex: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: "#16101f",
        }}
      >
        <Text style={{ color: "#f7e8ff", fontWeight: "600" }}>Bindu Lab</Text>
      </Pressable>
      <Pressable
        onPress={() => router.push("/sacred-symbol-stream")}
        style={{
          position: "absolute",
          top: 160,
          right: 16,
          zIndex: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: "#2a1327",
        }}
      >
        <Text style={{ color: "#ffe6fb", fontWeight: "600" }}>Symbol Stream</Text>
      </Pressable>
      <Pressable
        onPress={() => router.push("/breath-coherence")}
        style={{
          position: "absolute",
          top: 212,
          right: 16,
          zIndex: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: "#0c1f18",
        }}
      >
        <Text style={{ color: "#c6f6e9", fontWeight: "600" }}>Breath Coherence</Text>
      </Pressable>
      <Communicator
        systemPrompt="Ты эмпатичный наставник приложения Harmonizer. Отвечай кратко и по делу."
        memoryWindow={24}
      />
    </View>
  );
}
