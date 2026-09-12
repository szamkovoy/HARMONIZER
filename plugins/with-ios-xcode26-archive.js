const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

/**
 * Xcode 26.4 (Apple Clang 21 / iPhoneOS26.4.sdk) breaks two RN 0.81 Archive paths:
 * 1. User Script Sandboxing can fail `[RNDeps] Replace React Native Dependencies`.
 * 2. Vendored fmt 11.0.2 fails `FMT_STRING` consteval when RN is compiled from source.
 *
 * Precompiled RN (Expo default) is the path that used to succeed; this plugin keeps
 * that path working and patches fmt if the fmt pod is still present.
 */
const MARKER = "# @harmonizer/xcode26-archive";

const POST_INSTALL_SNIPPET = `
      ${MARKER}
      installer.pods_project.build_configurations.each do |bc|
        bc.build_settings["ENABLE_USER_SCRIPT_SANDBOXING"] = "NO"
      end
      installer.pods_project.targets.each do |target|
        target.build_configurations.each do |bc|
          bc.build_settings["ENABLE_USER_SCRIPT_SANDBOXING"] = "NO"
        end
      end
      fmt_base = File.join(installer.sandbox.root, "fmt", "include", "fmt", "base.h")
      if File.exist?(fmt_base)
        content = File.read(fmt_base)
        unless content.include?("Harmonizer Xcode 26 workaround")
          needle = "#elif defined(__cpp_consteval)\\n# define FMT_USE_CONSTEVAL 1"
          replacement = "#elif defined(__cpp_consteval)\\n# define FMT_USE_CONSTEVAL 0 /* Harmonizer Xcode 26 workaround */"
          patched = content.sub(needle, replacement)
          if patched != content
            File.chmod(0644, fmt_base)
            File.write(fmt_base, patched)
            Pod::UI.puts "[Harmonizer] Patched fmt FMT_USE_CONSTEVAL=0 for Xcode 26.4"
          end
        end
      end
`;

function withIosXcode26Podfile(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfilePath, "utf8");
      if (contents.includes(MARKER)) {
        return cfg;
      }
      if (!contents.includes("react_native_post_install(")) {
        throw new Error(
          "[Harmonizer] with-ios-xcode26-archive: Podfile has no react_native_post_install",
        );
      }
      const next = contents.replace(
        /react_native_post_install\(\s*installer,[\s\S]*?\)\n/,
        (match) => `${match}${POST_INSTALL_SNIPPET}\n`,
      );
      if (next === contents) {
        throw new Error(
          "[Harmonizer] with-ios-xcode26-archive: failed to inject Podfile post_install snippet",
        );
      }
      fs.writeFileSync(podfilePath, next);
      return cfg;
    },
  ]);
}

function withIosXcode26AppSandboxOff(config) {
  return withXcodeProject(config, (cfg) => {
    const configs = cfg.modResults.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configs)) {
      const item = configs[key];
      if (!item || typeof item !== "object" || !item.buildSettings) continue;
      item.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = "NO";
    }
    return cfg;
  });
}

function withIosXcode26Archive(config) {
  config = withIosXcode26Podfile(config);
  config = withIosXcode26AppSandboxOff(config);
  return config;
}

module.exports = withIosXcode26Archive;
