/**
 * Autolinking gates for native modules.
 *
 * `@react-native-firebase/*` must not link on iOS without GoogleService-Info.plist:
 * config plugins are already skipped in app.config.ts, but CocoaPods still
 * autolinks RNFBApp/RNFBAppCheck from package.json and then fails looking for
 * AppCheckCore (or later fails the RNFB GoogleService script phase).
 */
const fs = require("node:fs");
const path = require("node:path");

const hasIosFirebase =
  Boolean((process.env.GOOGLE_SERVICES_PLIST || "").trim()) ||
  fs.existsSync(path.join(__dirname, "GoogleService-Info.plist"));

module.exports = {
  dependencies: {
    ...(hasIosFirebase
      ? {}
      : {
          "@react-native-firebase/app": { platforms: { ios: null } },
          "@react-native-firebase/app-check": { platforms: { ios: null } },
        }),
  },
};
