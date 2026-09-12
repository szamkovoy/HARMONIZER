# frozen_string_literal: true

# Shared by patched RN CocoaPods helpers: copy Maven tarballs from a durable
# cache and expose file:// sources so `pod install` does not curl repo1.maven.org.

module HarmonizerRnIosArtifacts
  MIN_BYTES = 1_000_000

  def self.cache_dir(version)
    env = ENV["HARMONIZER_RN_ARTIFACTS_DIR"]
    return env unless env.nil? || env.empty?

    File.join(Dir.home, ".cache", "harmonizer", "react-native-artifacts", version)
  end

  def self.prefetch_script
    root = File.expand_path("..", Pod::Config.instance.installation_root)
    File.join(root, "scripts", "prefetch-rn-ios-artifacts.mjs")
  end

  def self.ensure_cached(version, maven_filename)
    path = File.join(cache_dir(version), maven_filename)
    return path if File.exist?(path) && File.size(path) >= MIN_BYTES

    script = prefetch_script
    unless File.exist?(script)
      raise "[Harmonizer] missing #{script}"
    end

    Pod::UI.puts "[Harmonizer] Prefetching RN iOS Maven artifacts (#{maven_filename})..." if Object.const_defined?("Pod::UI")
    unless system("node", script)
      raise "[Harmonizer] prefetch failed for #{maven_filename}. Run: node scripts/prefetch-rn-ios-artifacts.mjs"
    end
    unless File.exist?(path) && File.size(path) >= MIN_BYTES
      raise "[Harmonizer] still missing #{path}"
    end

    path
  end

  def self.install_into(destination_path, version, maven_filename)
    require "fileutils"
    cached = ensure_cached(version, maven_filename)
    FileUtils.mkdir_p(File.dirname(destination_path))
    unless File.exist?(destination_path) && File.size(destination_path) == File.size(cached)
      FileUtils.cp(cached, destination_path)
    end
    File.expand_path(destination_path)
  end

  def self.file_http_source(absolute_path)
    { :http => "file://#{absolute_path}" }
  end
end
