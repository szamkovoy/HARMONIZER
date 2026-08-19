type PermissionListener = () => void;
const permissionListeners = new Set<PermissionListener>();

/** GPS acquire / Settings return — UI re-reads expo-location permission. */
export function notifyForegroundLocationPermissionChanged(): void {
  permissionListeners.forEach((listener) => listener());
}

export function subscribeForegroundLocationPermissionChanged(listener: PermissionListener): () => void {
  permissionListeners.add(listener);
  return () => {
    permissionListeners.delete(listener);
  };
}
