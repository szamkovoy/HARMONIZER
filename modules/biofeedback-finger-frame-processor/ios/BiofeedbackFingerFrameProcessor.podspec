require "json"

package = JSON.parse(File.read(File.join(__dir__, "..", "package.json")))

Pod::Spec.new do |s|
  s.name = "BiofeedbackFingerFrameProcessor"
  s.version = package["version"]
  s.summary = package["description"]
  s.description = package["description"]
  s.license = package["license"]
  s.author = "HARMONIZER"
  s.homepage = "https://expo.dev"
  s.platforms = {
    :ios => "15.1"
  }
  s.source = {
    :path => "."
  }
  s.static_framework = true

  s.source_files = "**/*.{h,m,mm,swift}"
  s.dependency "ExpoModulesCore"
  s.dependency "VisionCamera"
end
