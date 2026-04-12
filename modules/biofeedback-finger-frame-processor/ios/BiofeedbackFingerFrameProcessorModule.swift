import ExpoModulesCore
import VisionCamera

public class BiofeedbackFingerFrameProcessorModule: Module {
  private static var hasRegisteredPlugin = false

  public func definition() -> ModuleDefinition {
    Name("BiofeedbackFingerFrameProcessor")

    Constants([
      "analyzeMethod": "analyzeFingerRoi"
    ])

    OnCreate {
      if !Self.hasRegisteredPlugin {
        FrameProcessorPluginRegistry.addFrameProcessorPlugin("analyzeFingerRoi") { proxy, options in
          BiofeedbackFingerFrameProcessorPlugin(proxy: proxy, options: options)
        }
        Self.hasRegisteredPlugin = true
      }
    }
  }
}
