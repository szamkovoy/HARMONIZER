import { useContext } from "react";

import { RemotePlayContext } from "./RemotePlayProvider";

export function useRemotePlay() {
  const value = useContext(RemotePlayContext);
  if (!value) {
    throw new Error("useRemotePlay must be used inside RemotePlayProvider");
  }
  return value;
}
