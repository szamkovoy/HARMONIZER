import { useEffect, useState } from "react";
import { AppText } from "@/modules/ui/AppText";

export function DecodingDots() {
  const [n, setN] = useState(1);

  useEffect(() => {
    const id = setInterval(() => {
      setN((x) => (x >= 5 ? 1 : x + 1));
    }, 280);
    return () => clearInterval(id);
  }, []);

  return <AppText variant="technicalCaption" tone="muted">{".".repeat(n)}</AppText>;
}
