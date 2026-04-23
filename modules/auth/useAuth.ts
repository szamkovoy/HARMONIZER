import { useContext } from "react";
import { AuthContext } from "./AuthProvider";
import type { AuthContextValue } from "./types";

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      "useAuth() must be used inside <AuthProvider>. Убедитесь, что корневой " +
        "_layout оборачивает приложение в AuthProvider.",
    );
  }
  return ctx;
}
