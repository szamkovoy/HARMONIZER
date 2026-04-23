import AVFoundation
import ExpoModulesCore
import Foundation
import UIKit
import VisionCamera

/*
 * TAG_ANDROID_ADAPTATION
 *
 * Этот модуль — iOS-only реализация. Для Android нужно создать зеркало
 * на Kotlin в `modules/biofeedback-finger-frame-processor/android/`.
 * Полный чек-лист функций и их Android-эквивалентов:
 *   `/docs/android-adaptation-notes.md`
 */

public class BiofeedbackFingerFrameProcessorModule: Module {
  private static var hasRegisteredPlugin = false
  private var thermalObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("BiofeedbackFingerFrameProcessor")

    Constants([
      "analyzeMethod": "analyzeFingerRoi"
    ])

    Events("onThermalStateChanged")

    OnCreate {
      if !Self.hasRegisteredPlugin {
        FrameProcessorPluginRegistry.addFrameProcessorPlugin("analyzeFingerRoi") { proxy, options in
          BiofeedbackFingerFrameProcessorPlugin(proxy: proxy, options: options)
        }
        Self.hasRegisteredPlugin = true
      }
      // Подписываемся на системное уведомление о смене теплового состояния.
      // iOS даёт только 4 уровня (nominal/fair/serious/critical), событие
      // приходит при переходе между ними. Используется гибридным режимом
      // измерения: при первом переходе в `fair` (первый «звонок» о нагреве)
      // переключаем сессию в эмуляцию пульса, пока телефон не остыл.
      self.thermalObserver = NotificationCenter.default.addObserver(
        forName: ProcessInfo.thermalStateDidChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        guard let self = self else { return }
        let state = Self.thermalStateString(ProcessInfo.processInfo.thermalState)
        self.sendEvent("onThermalStateChanged", ["state": state])
      }
    }

    OnDestroy {
      if let observer = self.thermalObserver {
        NotificationCenter.default.removeObserver(observer)
        self.thermalObserver = nil
      }
    }

    /**
     * Возвращает текущий уровень теплового состояния (ProcessInfo.thermalState).
     * Значения: "nominal" | "fair" | "serious" | "critical".
     *
     * - nominal: все хорошо, троттлинга нет.
     * - fair: первый «звонок», ОС готовится снижать частоты. **Рекомендуем
     *   на этом уровне уводить сессию в эмуляцию пульса**: графика ещё не
     *   тормозит, но тепло быстро накопится — лучше отпустить процессор.
     * - serious: частоты уже снижены, приложение начинает заметно лагать.
     * - critical: экстренное состояние, система может убить процесс.
     */
    AsyncFunction("getThermalState") { () -> String in
      return Self.thermalStateString(ProcessInfo.processInfo.thermalState)
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

    /**
     * TAG_REMOVE_PERF_DIAGNOSTICS
     *
     * Возвращает нативное использование памяти процессом (resident size) в
     * мегабайтах через `mach_task_basic_info`. На iOS это наиболее точный
     * и дешёвый способ получить «сколько реально занимает приложение» —
     * соответствует полю `Memory` в Xcode Debug Navigator.
     *
     * Используется диагностикой гибридного режима: если RSS непрерывно
     * растёт по ходу практики, это даёт независимый от теплового состояния
     * сигнал о возможной утечке / fragmentation.
     *
     * При ошибке возвращает -1.0 (sentinel). JS-слой отличает -1 от реального
     * нулевого RSS (которого на живом процессе быть не может) и пишет null
     * в диагностику. Важно: **не** возвращать 0.0 при ошибке — это было
     * источником путаницы: раньше JS фильтровал `v > 0`, и при реальном
     * kern_success был шанс, что для короткого всплеска вернётся очень
     * малое значение (округлённое до 0 при делении на 1M). Теперь
     * контракт однозначный: любое значение >= 0 — валидный RSS.
     */
    AsyncFunction("getMemoryUsageMb") { () -> Double in
      var info = mach_task_basic_info()
      var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
      let kerr: kern_return_t = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
        }
      }
      if kerr != KERN_SUCCESS {
        return -1.0
      }
      return Double(info.resident_size) / 1_048_576.0
    }

    /**
     * TAG_REMOVE_PERF_DIAGNOSTICS
     *
     * Уровень заряда батареи в процентах [0..100]. На iOS возвращает
     * ступенчатое значение (iOS округляет до ~5%), но для длительной
     * практики это всё равно полезно: если за 20 мин батарея упала на
     * 15-20%, это косвенно говорит о мощной нагрузке. Требует
     * `isBatteryMonitoringEnabled = true` (включаем один раз).
     *
     * Возвращает -1, если уровень неизвестен.
     */
    AsyncFunction("getBatteryLevelPct") { () -> Double in
      let device = UIDevice.current
      if !device.isBatteryMonitoringEnabled {
        device.isBatteryMonitoringEnabled = true
      }
      let lvl = device.batteryLevel // -1 если unknown, иначе 0.0..1.0
      if lvl < 0 { return -1.0 }
      return Double(lvl) * 100.0
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

  private static func thermalStateString(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "nominal"
    }
  }
}
