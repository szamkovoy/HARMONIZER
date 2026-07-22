package com.harmonizer.biofeedbackfingerframeprocessor

import android.graphics.ImageFormat
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.VisionCameraProxy
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Android mirror of iOS `BiofeedbackFingerFrameProcessorPlugin`.
 *
 * Reads a center ROI from YUV_420_888, converts sampled pixels to RGB (BT.601),
 * and returns the same JS contract as iOS (`redMean`, `lumaMean`, `redDominance`, …).
 *
 * Keep this hot-path lean: small ROI + stride sampling (no full-frame convert).
 */
class AnalyzeFingerRoiFrameProcessorPlugin(
  @Suppress("UNUSED_PARAMETER") proxy: VisionCameraProxy,
  @Suppress("UNUSED_PARAMETER") options: Map<String, Any>?,
) : FrameProcessorPlugin() {
  private var previousLumaRaw = 0f

  override fun callback(frame: Frame, params: Map<String, Any>?): Any? {
    val image = try {
      frame.image
    } catch (_: Throwable) {
      return null
    }

    if (image.format != ImageFormat.YUV_420_888) {
      // VisionCamera usually delivers YUV_420_888 on Android.
      return null
    }

    val roiScale = clamp((params?.get("roiScale") as? Number)?.toDouble() ?: 0.4, 0.18, 0.7)
    val sampleStride = max(2, ((params?.get("sampleStride") as? Number)?.toDouble() ?: 4.0).toInt())

    val width = image.width
    val height = image.height
    if (width < 8 || height < 8) return null

    val planes = image.planes
    if (planes.size < 3) return null

    val yPlane = planes[0]
    val uPlane = planes[1]
    val vPlane = planes[2]
    val yBuffer = yPlane.buffer.duplicate()
    val uBuffer = uPlane.buffer.duplicate()
    val vBuffer = vPlane.buffer.duplicate()
    val yRowStride = yPlane.rowStride
    val yPixelStride = yPlane.pixelStride
    val uRowStride = uPlane.rowStride
    val uPixelStride = uPlane.pixelStride
    val vRowStride = vPlane.rowStride
    val vPixelStride = vPlane.pixelStride

    val roiWidth = max(8, (width * roiScale).toInt())
    val roiHeight = max(8, (height * roiScale).toInt())
    val roiX = max(0, (width - roiWidth) / 2)
    val roiY = max(0, (height - roiHeight) / 2)
    val yStop = min(height, roiY + roiHeight)
    val xStop = min(width, roiX + roiWidth)

    var sumY = 0.0
    var sumR = 0.0
    var sumG = 0.0
    var sumB = 0.0
    var sumRedDominance = 0.0
    var darknessCount = 0
    var saturationCount = 0
    var sampleCount = 0

    var yy = roiY
    while (yy < yStop) {
      var xx = roiX
      while (xx < xStop) {
        val yIndex = yy * yRowStride + xx * yPixelStride
        if (yIndex < 0 || yIndex >= yBuffer.limit()) {
          xx += sampleStride
          continue
        }
        val yVal = (yBuffer.get(yIndex).toInt() and 0xff).toFloat()

        val uvX = xx / 2
        val uvY = yy / 2
        val uIndex = uvY * uRowStride + uvX * uPixelStride
        val vIndex = uvY * vRowStride + uvX * vPixelStride
        val cb = if (uIndex in 0 until uBuffer.limit()) {
          (uBuffer.get(uIndex).toInt() and 0xff) - 128f
        } else {
          0f
        }
        val cr = if (vIndex in 0 until vBuffer.limit()) {
          (vBuffer.get(vIndex).toInt() and 0xff) - 128f
        } else {
          0f
        }

        // BT.601 full-range YUV → RGB (same coefficients as iOS Accelerate path).
        var r = yVal + 1.402f * cr
        var g = yVal - 0.344136f * cb - 0.714136f * cr
        var b = yVal + 1.772f * cb
        r = min(255f, max(0f, r))
        g = min(255f, max(0f, g))
        b = min(255f, max(0f, b))

        sumY += yVal
        sumR += r
        sumG += g
        sumB += b
        sumRedDominance += r / (g + b + 1f)
        if (yVal < 18f) darknessCount += 1
        if (r > 252f || g > 252f || b > 252f) saturationCount += 1
        sampleCount += 1

        xx += sampleStride
      }
      yy += sampleStride
    }

    if (sampleCount <= 0) return null
    val n = sampleCount.toDouble()
    val meanY = (sumY / n).toFloat()
    val meanR = sumR / n
    val meanG = sumG / n
    val meanB = sumB / n
    val meanRedDominance = sumRedDominance / n
    val meanLuma = meanY / 255.0
    val motion = abs(meanY - previousLumaRaw) / 255.0
    previousLumaRaw = meanY

    val timestampNs = try {
      frame.timestamp
    } catch (_: Throwable) {
      System.nanoTime()
    }
    val timestampMs = timestampNs / 1_000_000.0

    return hashMapOf(
      "timestampMs" to timestampMs,
      "width" to width,
      "height" to height,
      "redMean" to meanR / 255.0,
      "greenMean" to meanG / 255.0,
      "blueMean" to meanB / 255.0,
      "lumaMean" to meanLuma,
      "redDominance" to meanRedDominance,
      "darknessRatio" to darknessCount / n,
      "saturationRatio" to saturationCount / n,
      "motion" to motion,
      "sampleCount" to sampleCount,
      "roiAreaRatio" to roiScale * roiScale,
    )
  }

  private fun clamp(value: Double, lo: Double, hi: Double): Double = min(hi, max(lo, value))
}
