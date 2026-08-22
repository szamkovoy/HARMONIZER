package com.harmonizer.androidexactalarms

import android.app.AlarmManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Mirrors AlarmManager.canScheduleExactAlarms() — the only reliable check for
 * Android 12+ «Alarms & reminders» grant (PermissionsAndroid.check is unreliable).
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
  }
}
