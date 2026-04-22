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
     * Нативное использование памяти процессом в мегабайтах.
     *
     * Ранее использовали `mach_task_basic_info` / `resident_size`, но у него
     * две проблемы: (1) на iOS 14+ `resident_size` сильно отличается от того,
     * что система считает «памятью приложения» (jetsam-лимит), (2) Swift-вызов
     * с плейсхолдером `mach_task_basic_info()` как default-init в некоторых
     * сборках тихо возвращал KERN_INVALID_ARGUMENT. Переходим на канонический
     * рецепт Apple — `task_vm_info` / `phys_footprint`: это ровно то число,
     * что Xcode показывает в Debug Navigator → Memory. Дешёвый (≪1 мкс),
     * thread-safe, работает на симуляторе и на устройстве.
     *
     * Возвращает `-1`, если `task_info` вернул ошибку — JS-обёртка трактует
     * такое значение как `null` и пишет в лог причину (через console.warn)
     * один раз за сессию, чтобы не забивать Metro-терминал.
     */
    AsyncFunction("getMemoryUsageMb") { () -> Double in
      var info = task_vm_info_data_t()
      var count = mach_msg_type_number_t(
        MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size
      )
      let kr: kern_return_t = withUnsafeMutablePointer(to: &info) { infoPtr in
        infoPtr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { intPtr in
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), intPtr, &count)
        }
      }
      if kr != KERN_SUCCESS {
        return -1.0
      }
      return Double(info.phys_footprint) / 1_048_576.0
    }

    /**
     * TAG_REMOVE_PERF_DIAGNOSTICS
     *
     * Уровень заряда батареи в процентах [0..100].
     *
     * Важно: `UIDevice.current` и `batteryLevel` требуют main-thread. Expo
     * `AsyncFunction` по-умолчанию диспатчит в фоновую очередь, и в прошлой
     * реализации мы читали `batteryLevel` вне main — результат был `-1.0`
     * на всех сэмплах. Здесь явно уходим в `DispatchQueue.main.sync`, это
     * безопасно (вызывающая очередь — не main) и стоит микросекунды.
     *
     * iOS возвращает ступенчатое значение (~5%), но для 20-минутной практики
     * этого достаточно, чтобы оценить падение заряда как косвенный признак
     * нагрузки CPU/камеры/LED. Возвращает `-1`, если определить не удалось.
     */
    AsyncFunction("getBatteryLevelPct") { () -> Double in
      return DispatchQueue.main.sync {
        let device = UIDevice.current
        if !device.isBatteryMonitoringEnabled {
          device.isBatteryMonitoringEnabled = true
        }
        let lvl = device.batteryLevel // -1 если unknown, иначе 0.0..1.0
        if lvl < 0 { return -1.0 }
        return Double(lvl) * 100.0
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
