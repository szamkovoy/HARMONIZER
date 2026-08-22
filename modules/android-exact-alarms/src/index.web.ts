export async function canScheduleExactAlarmsNative(): Promise<boolean | null> {
  return true;
}

export async function isIgnoringBatteryOptimizationsNative(): Promise<boolean | null> {
  return true;
}

export async function openBatteryOptimizationRequestNative(): Promise<boolean> {
  return false;
}

export async function getRestrictiveManufacturerKeyNative(): Promise<string | null> {
  return null;
}

export async function openManufacturerBackgroundSettingsNative(): Promise<boolean> {
  return false;
}
