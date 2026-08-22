package com.harmonizer.androidexactalarms

import android.app.AlarmManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Exact alarms + battery / OEM background guards for opportunity DATE reminders.
 */
class AndroidExactAlarmsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AndroidExactAlarms")

    AsyncFunction("canScheduleExactAlarms") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        return@AsyncFunction true
      }
      val context = appContext.reactContext ?: return@AsyncFunction false
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
      alarmManager?.canScheduleExactAlarms() ?: false
    }

    AsyncFunction("isIgnoringBatteryOptimizations") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
        return@AsyncFunction true
      }
      val context = appContext.reactContext ?: return@AsyncFunction false
      val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return@AsyncFunction false
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    AsyncFunction("openBatteryOptimizationRequest") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      openBatteryOptimizationRequest(context)
    }

    AsyncFunction("getRestrictiveManufacturerKey") {
      restrictiveManufacturerKey()
    }

    AsyncFunction("openManufacturerBackgroundSettings") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      openManufacturerBackgroundSettings(context)
    }
  }

  private fun restrictiveManufacturerKey(): String? {
    val combined = "${Build.MANUFACTURER} ${Build.BRAND}".lowercase()
    return when {
      combined.contains("xiaomi") || combined.contains("redmi") || combined.contains("poco") -> "xiaomi"
      combined.contains("huawei") || combined.contains("honor") -> "huawei"
      combined.contains("oppo") || combined.contains("realme") -> "oppo"
      combined.contains("vivo") || combined.contains("iqoo") -> "vivo"
      combined.contains("oneplus") -> "oneplus"
      combined.contains("meizu") -> "meizu"
      else -> null
    }
  }

  private fun openBatteryOptimizationRequest(context: Context): Boolean {
    val pkg = context.packageName
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      try {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:$pkg")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        if (intent.resolveActivity(context.packageManager) != null) {
          context.startActivity(intent)
          return true
        }
      } catch (_: Throwable) {
        /* fall through */
      }
      try {
        val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        if (intent.resolveActivity(context.packageManager) != null) {
          context.startActivity(intent)
          return true
        }
      } catch (_: Throwable) {
        /* fall through */
      }
    }
    return openAppDetailsSettings(context)
  }

  private fun openManufacturerBackgroundSettings(context: Context): Boolean {
    val pkg = context.packageName
    val candidates = mutableListOf<Intent>()

    when (restrictiveManufacturerKey()) {
      "xiaomi" -> {
        candidates.add(
          Intent().setComponent(
            ComponentName(
              "com.miui.securitycenter",
              "com.miui.permcenter.autostart.AutoStartManagementActivity",
            ),
          ),
        )
        candidates.add(
          Intent().setComponent(
            ComponentName(
              "com.miui.securitycenter",
              "com.miui.powercenter.PowerSettings",
            ),
          ),
        )
      }
      "huawei" -> {
        candidates.add(
          Intent().setComponent(
            ComponentName(
              "com.huawei.systemmanager",
              "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            ),
          ),
        )
        candidates.add(
          Intent().setComponent(
            ComponentName(
              "com.huawei.systemmanager",
              "com.huawei.systemmanager.optimize.process.ProtectActivity",
            ),
          ),
        )
      }
      "oppo" -> {
        candidates.add(
          Intent().setComponent(
            ComponentName(
              "com.coloros.safecenter",
              "com.coloros.safecenter.permission.startup.StartupAppListActivity",
            ),
          ),
        )
        candidates.add(
          Intent().setComponent(
            ComponentName(
              "com.oppo.safe",
              "com.oppo.safe.permission.startup.StartupAppListActivity",
            ),
          ),
        )
      }
      "vivo" -> {
        candidates.add(
          Intent().setComponent(
            ComponentName(
              "com.vivo.permissionmanager",
              "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
            ),
          ),
        )
        candidates.add(
          Intent().setComponent(
            ComponentName(
              "com.iqoo.secure",
              "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
            ),
          ),
        )
      }
      "oneplus" -> {
        candidates.add(
          Intent().setComponent(
            ComponentName(
              "com.oneplus.security",
              "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity",
            ),
          ),
        )
      }
      "meizu" -> {
        candidates.add(
          Intent().setComponent(
            ComponentName(
              "com.meizu.safe",
              "com.meizu.safe.security.SHOW_APPSEC",
            ),
          ).apply {
            putExtra("packageName", pkg)
          },
        )
      }
    }

    candidates.add(
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.fromParts("package", pkg, null)
      },
    )

    for (intent in candidates) {
      try {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(context.packageManager) != null) {
          context.startActivity(intent)
          return true
        }
      } catch (_: Throwable) {
        /* try next */
      }
    }
    return false
  }

  private fun openAppDetailsSettings(context: Context): Boolean {
    return try {
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.fromParts("package", context.packageName, null)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
      true
    } catch (_: Throwable) {
      false
    }
  }
}
