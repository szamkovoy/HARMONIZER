import Accelerate
import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import VisionCamera

/**
 * FrameProcessorPlugin для извлечения PPG-характеристик из ROI NV12-кадра.
 *
 * Оптимизированная версия (Accelerate/vDSP):
 *
 *  - Было: двойной вложенный цикл на `Double`, который на каждый
 *    пиксель выполнял ~20 FP-операций (YUV→RGB, redDominance через
 *    деление, аккумуляция пяти сумм). При ROI ~32×24 = 768 сэмплов и
 *    10 fps это ~150 k double-ops/с, плюс bounds-check-ы Swift'а.
 *    Одновременный торч на 100 % яркости и ISP + этот hot loop
 *    раскаляли телефон и вызывали thermal throttling.
 *
 *  - Стало: один проход копирует Y/Cb/Cr из NV12 в три плоских Float-
 *    буфера, а все редукции и преобразования делают vDSP-функции
 *    (NEON SIMD, 4-8× ускорение на ARM):
 *      · `vDSP_vsadd`     — вычитание 128 из UV in-place
 *      · `vDSP_vsma`      — R = Y + 1.402·(Cr−128), B = Y + 1.772·(Cb−128)
 *      · `vDSP_vsmul+vsma+vadd` — G = Y − 0.344·(Cb−128) − 0.714·(Cr−128)
 *      · `vDSP_vclip`     — clamp [0, 255]
 *      · `vDSP_meanv`     — средние Y/R/G/B
 *      · `vDSP_vadd+vsadd+vdiv+meanv` — redDominance = mean(R/(G+B+1))
 *
 *    Скалярными остались только два дешёвых Float-прохода (darkness
 *    и saturation counts), потому что vDSP не умеет count-above-
 *    threshold, а копировать в int-буфер ради этого дороже, чем
 *    сравнить 768 Float'ов напрямую.
 *
 *    Буферы выделяются ЛЕНИВО и переиспользуются — аллокаций в hot
 *    loop нет (важно и для CPU, и для GC-давления на JS-стороне).
 */
@objc(BiofeedbackFingerFrameProcessorPlugin)
public class BiofeedbackFingerFrameProcessorPlugin: FrameProcessorPlugin {
  private var previousLumaRaw: Float = 0.0

  // Persistent-буферы под ROI-сэмплы (lazy-alloc, переаллок только при
  // изменении размера ROI; в стационарном режиме выделений нет).
  private var yFloats: UnsafeMutablePointer<Float>? = nil
  private var cbFloats: UnsafeMutablePointer<Float>? = nil
  private var crFloats: UnsafeMutablePointer<Float>? = nil
  private var rFloats: UnsafeMutablePointer<Float>? = nil
  private var gFloats: UnsafeMutablePointer<Float>? = nil
  private var bFloats: UnsafeMutablePointer<Float>? = nil
  private var tmpFloats: UnsafeMutablePointer<Float>? = nil
  private var bufferCapacity: Int = 0

  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]! = [:]) {
    super.init(proxy: proxy, options: options)
  }

  deinit {
    yFloats?.deallocate()
    cbFloats?.deallocate()
    crFloats?.deallocate()
    rFloats?.deallocate()
    gFloats?.deallocate()
    bFloats?.deallocate()
    tmpFloats?.deallocate()
  }

  private func ensureCapacity(_ needed: Int) {
    if needed <= bufferCapacity { return }
    yFloats?.deallocate()
    cbFloats?.deallocate()
    crFloats?.deallocate()
    rFloats?.deallocate()
    gFloats?.deallocate()
    bFloats?.deallocate()
    tmpFloats?.deallocate()
    yFloats = UnsafeMutablePointer<Float>.allocate(capacity: needed)
    cbFloats = UnsafeMutablePointer<Float>.allocate(capacity: needed)
    crFloats = UnsafeMutablePointer<Float>.allocate(capacity: needed)
    rFloats = UnsafeMutablePointer<Float>.allocate(capacity: needed)
    gFloats = UnsafeMutablePointer<Float>.allocate(capacity: needed)
    bFloats = UnsafeMutablePointer<Float>.allocate(capacity: needed)
    tmpFloats = UnsafeMutablePointer<Float>.allocate(capacity: needed)
    bufferCapacity = needed
  }

  public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else {
      return nil
    }

    let roiScale = clampDouble(arguments?["roiScale"] as? Double ?? 0.4, min: 0.18, max: 0.7)
    let sampleStride = max(2, Int(arguments?["sampleStride"] as? Double ?? 4))
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)

    guard CVPixelBufferGetPlaneCount(pixelBuffer) >= 2 else {
      return nil
    }

    let roiWidth = max(8, Int(Double(width) * roiScale))
    let roiHeight = max(8, Int(Double(height) * roiScale))
    let roiX = max(0, (width - roiWidth) / 2)
    let roiY = max(0, (height - roiHeight) / 2)

    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer {
      CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly)
    }

    guard
      let yBaseAddress = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0),
      let uvBaseAddress = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 1)
    else {
      return nil
    }

    let yBytesPerRow = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
    let uvBytesPerRow = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 1)

    let yPlane = yBaseAddress.assumingMemoryBound(to: UInt8.self)
    let uvPlane = uvBaseAddress.assumingMemoryBound(to: UInt8.self)

    let sampledRows = (roiHeight + sampleStride - 1) / sampleStride
    let sampledCols = (roiWidth + sampleStride - 1) / sampleStride
    let plannedSamples = sampledRows * sampledCols
    guard plannedSamples > 0 else {
      return nil
    }
    ensureCapacity(plannedSamples)
    guard
      let yBuf = yFloats,
      let cbBuf = cbFloats,
      let crBuf = crFloats,
      let rBuf = rFloats,
      let gBuf = gFloats,
      let bBuf = bFloats,
      let tmpBuf = tmpFloats
    else {
      return nil
    }

    // ---- ОДИН проход: UInt8 Y/Cb/Cr → Float-буферы ------------------------
    // Дальше на эти буферы работает vDSP/NEON — скалярных FP-операций
    // «на пиксель» больше нет.
    let uvHalfHeight = max(1, height / 2)
    let uvHalfWidth = max(1, width / 2)
    var writeIndex = 0
    let yStop = roiY + roiHeight
    let xStop = roiX + roiWidth
    var yy = roiY
    while yy < yStop {
      let uvY = min(uvHalfHeight - 1, yy / 2)
      let yRowBase = yy * yBytesPerRow
      let uvRowBase = uvY * uvBytesPerRow
      var xx = roiX
      while xx < xStop {
        let uvX = min(uvHalfWidth - 1, xx / 2)
        yBuf[writeIndex] = Float(yPlane[yRowBase + xx])
        cbBuf[writeIndex] = Float(uvPlane[uvRowBase + uvX * 2])
        crBuf[writeIndex] = Float(uvPlane[uvRowBase + uvX * 2 + 1])
        writeIndex += 1
        xx += sampleStride
      }
      yy += sampleStride
    }
    let n = writeIndex
    guard n > 0 else { return nil }
    let countU = vDSP_Length(n)

    // ---- UV в signed (вычитаем 128) ---------------------------------------
    // cbBuf := cbBuf - 128; crBuf := crBuf - 128
    var negBias: Float = -128.0
    vDSP_vsadd(cbBuf, 1, &negBias, cbBuf, 1, countU)
    vDSP_vsadd(crBuf, 1, &negBias, crBuf, 1, countU)

    // ---- YUV → RGB через vDSP (SIMD) --------------------------------------
    // R = Y + 1.402 · (Cr)
    var cR: Float = 1.402
    vDSP_vsma(crBuf, 1, &cR, yBuf, 1, rBuf, 1, countU)
    // B = Y + 1.772 · (Cb)
    var cB: Float = 1.772
    vDSP_vsma(cbBuf, 1, &cB, yBuf, 1, bBuf, 1, countU)
    // G = Y − 0.344136·Cb − 0.714136·Cr
    //   = (−0.344136·Cb) + (−0.714136·Cr) + Y
    var cG1: Float = -0.344136
    vDSP_vsmul(cbBuf, 1, &cG1, gBuf, 1, countU)
    var cG2: Float = -0.714136
    vDSP_vsma(crBuf, 1, &cG2, gBuf, 1, gBuf, 1, countU)
    vDSP_vadd(gBuf, 1, yBuf, 1, gBuf, 1, countU)

    // ---- clip в [0, 255] --------------------------------------------------
    var low: Float = 0.0
    var high: Float = 255.0
    vDSP_vclip(rBuf, 1, &low, &high, rBuf, 1, countU)
    vDSP_vclip(gBuf, 1, &low, &high, gBuf, 1, countU)
    vDSP_vclip(bBuf, 1, &low, &high, bBuf, 1, countU)

    // ---- Средние по каналам -----------------------------------------------
    var meanY: Float = 0
    var meanR: Float = 0
    var meanG: Float = 0
    var meanB: Float = 0
    vDSP_meanv(yBuf, 1, &meanY, countU)
    vDSP_meanv(rBuf, 1, &meanR, countU)
    vDSP_meanv(gBuf, 1, &meanG, countU)
    vDSP_meanv(bBuf, 1, &meanB, countU)

    // ---- redDominance: mean(R / (G + B + 1)) ------------------------------
    // tmp := G + B
    vDSP_vadd(gBuf, 1, bBuf, 1, tmpBuf, 1, countU)
    // tmp := tmp + 1  (защита от деления на 0)
    var one: Float = 1.0
    vDSP_vsadd(tmpBuf, 1, &one, tmpBuf, 1, countU)
    // tmp := R / tmp
    vDSP_vdiv(tmpBuf, 1, rBuf, 1, tmpBuf, 1, countU)
    var meanRedDominance: Float = 0
    vDSP_meanv(tmpBuf, 1, &meanRedDominance, countU)

    // ---- darkness / saturation counts -------------------------------------
    // vDSP не даёт прямой «count-above-threshold». Для 700-800 Float'ов
    // скалярный проход — ~2 µs на современном ARM, не влияет на общую
    // картину. Сам компилятор в -O выдаёт NEON-векторизованный код для
    // таких простых циклов.
    var darknessCount = 0
    var saturationCount = 0
    for i in 0..<n {
      if yBuf[i] < 18.0 {
        darknessCount += 1
      }
      if rBuf[i] > 252.0 || gBuf[i] > 252.0 || bBuf[i] > 252.0 {
        saturationCount += 1
      }
    }

    // ---- Сборка итогового контракта (идентично прежней версии) ------------
    let nD = Double(n)
    let meanLuma = Double(meanY) / 255.0
    let meanRed = Double(meanR) / 255.0
    let meanGreen = Double(meanG) / 255.0
    let meanBlue = Double(meanB) / 255.0
    let darknessRatio = Double(darknessCount) / nD
    let saturationRatio = Double(saturationCount) / nD
    let motion = Double(abs(meanY - previousLumaRaw)) / 255.0
    previousLumaRaw = meanY

    let presentationTimestamp = CMSampleBufferGetPresentationTimeStamp(frame.buffer)
    let timestampMs = CMTimeGetSeconds(presentationTimestamp) * 1000.0

    return [
      "timestampMs": timestampMs,
      "width": width,
      "height": height,
      "redMean": meanRed,
      "greenMean": meanGreen,
      "blueMean": meanBlue,
      "lumaMean": meanLuma,
      "redDominance": Double(meanRedDominance),
      "darknessRatio": darknessRatio,
      "saturationRatio": saturationRatio,
      "motion": motion,
      "sampleCount": n,
      "roiAreaRatio": roiScale * roiScale
    ]
  }

  private func clampDouble(_ value: Double, min lowerBound: Double, max upperBound: Double) -> Double {
    Swift.min(upperBound, Swift.max(lowerBound, value))
  }
}
