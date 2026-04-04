import { useEffect, useState } from "react";
import { Text } from "react-native";

export function DecodingDots() {
  const [n, setN] = useState(1);

  useEffect(() => {
    const id = setInterval(() => {
      setN((x) => (x >= 5 ? 1 : x + 1));
    }, 280);
    return () => clearInterval(id);
  }, []);

  return <Text aria-hidden>{".".repeat(n)}</Text>;
}
