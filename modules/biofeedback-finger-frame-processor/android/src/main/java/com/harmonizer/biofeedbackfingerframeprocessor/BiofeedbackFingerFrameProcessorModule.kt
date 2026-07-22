package com.harmonizer.biofeedbackfingerframeprocessor

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.BatteryManager
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry

/**
 * Expo Module: torch / thermal / diagnostics + VisionCamera plugin registration.
 * Mirrors iOS `BiofeedbackFingerFrameProcessorModule`.
 */
class BiofeedbackFingerFrameProcessorModule : Module() {
  companion object {
    private const val TAG = "FingerFrameProcessor"
    @Volatile
    private var pluginRegistered = false

    private fun ensurePluginRegistered() {
      if (pluginRegistered) return
      synchronized(this) {
        if (pluginRegistered) return
        FrameProcessorPluginRegistry.addFrameProcessorPlugin("analyzeFingerRoi") { proxy, options ->
          AnalyzeFingerRoiFrameProcessorPlugin(proxy, options)
        }
        pluginRegistered = true
        Log.i(TAG, "Registered analyzeFingerRoi frame processor plugin")
      }
    }
  }

  private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null

  override fun definition() = ModuleDefinition {
    Name("BiofeedbackFingerFrameProcessor")

    Constants(
      "analyzeMethod" to "analyzeFingerRoi",
    )

    Events("onThermalStateChanged")

    OnCreate {
      ensurePluginRegistered()
      registerThermalListener()
    }

    OnDestroy {
      unregisterThermalListener()
    }

    AsyncFunction("getThermalState") {
      thermalStateString(currentThermalStatus())
    }

    AsyncFunction("setBackTorchLevel") { level: Double ->
      setTorchLevel(level.coerceIn(0.05, 1.0))
    }

    AsyncFunction("turnOffBackTorch") {
      setTorchEnabled(false)
    }

    AsyncFunction("getMemoryUsageMb") {
      try {
        val info = Debug.MemoryInfo()
        Debug.getMemoryInfo(info)
        info.totalPss / 1024.0
      } catch (_: Throwable) {
        -1.0
      }
    }

    AsyncFunction("getBatteryLevelPct") {
      try {
        val context = appContext.reactContext ?: return@AsyncFunction -1.0
        val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val capacity = batteryManager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        if (capacity != null && capacity in 0..100) {
          return@AsyncFunction capacity.toDouble()
        }
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        if (level < 0 || scale <= 0) -1.0 else (level * 100.0) / scale
      } catch (_: Throwable) {
        -1.0
      }
    }
  }

  private fun appContextCameraManager(): CameraManager? {
    val context = appContext.reactContext ?: return null
    return context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
  }

  private fun findBackTorchCameraId(manager: CameraManager): String? {
    for (id in manager.cameraIdList) {
      val chars = manager.getCameraCharacteristics(id)
      val facing = chars.get(CameraCharacteristics.LENS_FACING)
      val flash = chars.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
      if (facing == CameraCharacteristics.LENS_FACING_BACK && flash) {
        return id
      }
    }
    return null
  }

  private fun setTorchEnabled(enabled: Boolean): Boolean {
    return try {
      val manager = appContextCameraManager() ?: return false
      val cameraId = findBackTorchCameraId(manager) ?: return false
      manager.setTorchMode(cameraId, enabled)
      true
    } catch (error: Throwable) {
      Log.w(TAG, "setTorchMode failed", error)
      false
    }
  }

  private fun setTorchLevel(level: Double): Boolean {
    return try {
      val manager = appContextCameraManager() ?: return false
      val cameraId = findBackTorchCameraId(manager) ?: return false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val chars = manager.getCameraCharacteristics(cameraId)
        val maxLevel = chars.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL) ?: 1
        if (maxLevel > 1) {
          val strength = maxOf(1, minOf(maxLevel, Math.round(level * maxLevel).toInt()))
          manager.turnOnTorchWithStrengthLevel(cameraId, strength)
          return true
        }
      }
      manager.setTorchMode(cameraId, true)
      true
    } catch (error: Throwable) {
      Log.w(TAG, "setTorchLevel failed", error)
      false
    }
  }

  private fun currentThermalStatus(): Int {
    val context = appContext.reactContext ?: return PowerManager.THERMAL_STATUS_NONE
    val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return PowerManager.THERMAL_STATUS_NONE
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      pm.currentThermalStatus
    } else {
      PowerManager.THERMAL_STATUS_NONE
    }
  }

  private fun thermalStateString(status: Int): String {
    return when (status) {
      PowerManager.THERMAL_STATUS_NONE,
      PowerManager.THERMAL_STATUS_LIGHT,
      -> "nominal"
      PowerManager.THERMAL_STATUS_MODERATE -> "fair"
      PowerManager.THERMAL_STATUS_SEVERE -> "serious"
      PowerManager.THERMAL_STATUS_CRITICAL,
      PowerManager.THERMAL_STATUS_EMERGENCY,
      PowerManager.THERMAL_STATUS_SHUTDOWN,
      -> "critical"
      else -> "nominal"
    }
  }

  private fun registerThermalListener() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val context = appContext.reactContext ?: return
    val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    if (thermalListener != null) return
    val listener = PowerManager.OnThermalStatusChangedListener { status ->
      sendEvent("onThermalStateChanged", mapOf("state" to thermalStateString(status)))
    }
    thermalListener = listener
    pm.addThermalStatusListener(context.mainExecutor, listener)
  }

  private fun unregisterThermalListener() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val context = appContext.reactContext ?: return
    val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    val listener = thermalListener ?: return
    pm.removeThermalStatusListener(listener)
    thermalListener = null
  }
}
