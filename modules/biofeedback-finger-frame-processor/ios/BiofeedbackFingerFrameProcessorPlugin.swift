import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import VisionCamera

@objc(BiofeedbackFingerFrameProcessorPlugin)
public class BiofeedbackFingerFrameProcessorPlugin: FrameProcessorPlugin {
  private var previousLumaMean = 0.0

  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]! = [:]) {
    super.init(proxy: proxy, options: options)
  }

  public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else {
      return nil
    }

    let roiScale = clampNumber(arguments?["roiScale"] as? Double ?? 0.4, min: 0.18, max: 0.7)
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

    let yBuffer = yBaseAddress.assumingMemoryBound(to: UInt8.self)
    let uvBuffer = uvBaseAddress.assumingMemoryBound(to: UInt8.self)

    var redSum = 0.0
    var greenSum = 0.0
    var blueSum = 0.0
    var lumaSum = 0.0
    var redDominanceSum = 0.0
    var darknessCount = 0
    var saturationCount = 0
    var sampledPixels = 0

    let yMax = roiY + roiHeight
    let xMax = roiX + roiWidth

    for y in stride(from: roiY, to: yMax, by: sampleStride) {
      let uvY = min(height / 2 - 1, y / 2)
      let yRow = y * yBytesPerRow
      let uvRow = uvY * uvBytesPerRow

      for x in stride(from: roiX, to: xMax, by: sampleStride) {
        let yValue = Double(yBuffer[yRow + x])
        let uvX = min(width / 2 - 1, x / 2)
        let uvOffset = uvRow + uvX * 2
        let cbValue = Double(uvBuffer[uvOffset])
        let crValue = Double(uvBuffer[uvOffset + 1])

        let red = clampNumber(yValue + 1.402 * (crValue - 128.0), min: 0.0, max: 255.0)
        let green = clampNumber(yValue - 0.344_136 * (cbValue - 128.0) - 0.714_136 * (crValue - 128.0), min: 0.0, max: 255.0)
        let blue = clampNumber(yValue + 1.772 * (cbValue - 128.0), min: 0.0, max: 255.0)
        let normalizedRedDominance = red / max(1.0, green + blue)

        redSum += red
        greenSum += green
        blueSum += blue
        lumaSum += yValue
        redDominanceSum += normalizedRedDominance

        if yValue < 18.0 {
          darknessCount += 1
        }

        if red > 252.0 || green > 252.0 || blue > 252.0 {
          saturationCount += 1
        }

        sampledPixels += 1
      }
    }

    guard sampledPixels > 0 else {
      return nil
    }

    let meanLuma = (lumaSum / Double(sampledPixels)) / 255.0
    let meanRed = (redSum / Double(sampledPixels)) / 255.0
    let meanGreen = (greenSum / Double(sampledPixels)) / 255.0
    let meanBlue = (blueSum / Double(sampledPixels)) / 255.0
    let meanRedDominance = redDominanceSum / Double(sampledPixels)
    let darknessRatio = Double(darknessCount) / Double(sampledPixels)
    let saturationRatio = Double(saturationCount) / Double(sampledPixels)
    let motion = abs(meanLuma - previousLumaMean)
    previousLumaMean = meanLuma

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
      "redDominance": meanRedDominance,
      "darknessRatio": darknessRatio,
      "saturationRatio": saturationRatio,
      "motion": motion,
      "sampleCount": sampledPixels,
      "roiAreaRatio": roiScale * roiScale
    ]
  }

  private func clampNumber(_ value: Double, min lowerBound: Double, max upperBound: Double) -> Double {
    Swift.min(upperBound, Swift.max(lowerBound, value))
  }
}
