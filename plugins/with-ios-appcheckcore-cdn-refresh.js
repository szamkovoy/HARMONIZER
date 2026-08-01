const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Firebase AppCheck (RNFB) needs AppCheckCore ~> 11.3. CocoaPods CDN may keep a
 * stale `all_pods_versions_*.txt` (+ etag) that stops at 11.2.0 — then fresh EAS
 * `pod install` fails with exit 31 even after `pod repo update`.
 *
 * Inject a Podfile preamble that refreshes that shard when 11.3.x is missing.
 * (Local EAS does not always run `eas-build-post-install`.)
 */
const MARKER = "# @harmonizer/appcheckcore-cdn-refresh";

const PREAMBLE = `${MARKER}
# Refresh CocoaPods CDN shard if AppCheckCore ~> 11.3 is missing from local cache.
begin
  require "digest"
  require "fileutils"
  trunk = File.expand_path("~/.cocoapods/repos/trunk")
  shard = Digest::MD5.hexdigest("AppCheckCore").chars.values_at(0, 1, 2).join("_")
  versions_path = File.join(trunk, "all_pods_versions_#{shard}.txt")
  etag_path = versions_path + ".etag"
  cached = File.exist?(versions_path) ? File.read(versions_path) : ""
  unless cached.include?("AppCheckCore/") && cached.include?("/11.3")
    Pod::UI.puts "[Harmonizer] CocoaPods CDN missing AppCheckCore 11.3.x — refreshing shard #{shard}..."
    FileUtils.mkdir_p(trunk)
    FileUtils.rm_f([versions_path, etag_path])
    url = "https://cdn.cocoapods.org/all_pods_versions_#{shard}.txt"
    unless system("curl", "-fsSL", url, "-o", versions_path)
      Pod::UI.warn "[Harmonizer] curl CDN refresh failed; falling back to pod repo update"
      system("pod", "repo", "update")
    end
  end
rescue => e
  Pod::UI.warn "[Harmonizer] AppCheckCore CDN refresh skipped: #{e.message}"
end
`;

function withIosAppCheckCoreCdnRefresh(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfilePath, "utf8");
      if (contents.includes(MARKER)) {
        return cfg;
      }
      fs.writeFileSync(podfilePath, `${PREAMBLE}\n${contents}`);
      return cfg;
    },
  ]);
}

module.exports = withIosAppCheckCoreCdnRefresh;
