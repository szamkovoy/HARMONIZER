/**
 * Suppresses the native blue "Refreshing..." HMR banner in dev builds.
 * Fast Refresh still runs; only the overlay is hidden (production has none).
 */
export function installDevLoadingViewPatch(): void {
  if (!__DEV__) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const DevLoadingView = require("react-native/Libraries/Utilities/DevLoadingView").default as {
      showMessage: (message: string, type: "load" | "refresh") => void;
      hide: () => void;
    };
    const showMessage = DevLoadingView.showMessage.bind(DevLoadingView);
    DevLoadingView.showMessage = (message, type) => {
      if (type === "refresh") return;
      showMessage(message, type);
    };
  } catch {
    // Optional in web / unusual runtimes.
  }
}
