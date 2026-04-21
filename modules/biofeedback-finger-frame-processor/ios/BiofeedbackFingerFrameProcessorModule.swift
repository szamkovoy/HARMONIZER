import AVFoundation
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

    /**
     * Снижает яркость задней вспышки (torch) для PPG-замеров.
     *
     * VisionCamera умеет включать torch в режиме on/off, но не управляет
     * яркостью. Для PPG полная яркость (level = 1.0) не нужна — пальцу на
     * вспышке достаточно уровня ~0.25–0.4, чтобы просвет был ровным и
     * контрастным. Снижение с 1.0 до 0.35 резко сокращает тепловыделение
     * светодиода (яркость LED ~ линейна, а нагрев ~ квадратичен с током),
     * что напрямую борется с перегревом телефона и последующим thermal
     * throttling'ом ISP/CPU.
     *
     * Вызывать ПОСЛЕ того, как VisionCamera уже включил torch (torch="on"
     * на `<Camera>`), иначе при попытке получить lock может оказаться,
     * что сессия ещё не активна. Безопасно вызывать несколько раз — мы
     * просто меняем уровень.
     */
    AsyncFunction("setBackTorchLevel") { (level: Double) -> Bool in
      let clamped = Float(max(0.05, min(1.0, level)))
      guard let device = Self.findBackTorchDevice() else {
        return false
      }
      guard device.hasTorch else {
        return false
      }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        if device.torchMode != .on || abs(device.torchLevel - clamped) > 0.01 {
          try device.setTorchModeOn(level: clamped)
        }
        return true
      } catch {
        return false
      }
    }

    /**
     * Выключает torch (например при остановке практики). Используется,
     * чтобы после нашего `setBackTorchLevel` не остался «прилипший»
     * уровень на случай, если VisionCamera будет менять torch в режиме
     * on/off — у неё свой lock-цикл, и состояние может рассинхронизиро-
     * ваться. На практике обычно не нужно, но оставляем как safety-net.
     */
    AsyncFunction("turnOffBackTorch") { () -> Bool in
      guard let device = Self.findBackTorchDevice() else {
        return false
      }
      guard device.hasTorch else {
        return false
      }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        if device.torchMode != .off {
          device.torchMode = .off
        }
        return true
      } catch {
        return false
      }
    }
  }

  private static func findBackTorchDevice() -> AVCaptureDevice? {
    if let d = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) {
      return d
    }
    let session = AVCaptureDevice.DiscoverySession(
      deviceTypes: [.builtInWideAngleCamera, .builtInDualCamera, .builtInTripleCamera],
      mediaType: .video,
      position: .back
    )
    return session.devices.first
  }
}
