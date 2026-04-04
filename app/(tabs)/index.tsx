import { Communicator } from "@/modules/communicator/ui/Communicator";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";

export default function CommunicatorScreen() {
  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <Communicator
        systemPrompt="Ты эмпатичный наставник приложения Harmonizer. Отвечай кратко и по делу."
        memoryWindow={24}
      />
    </View>
  );
}
