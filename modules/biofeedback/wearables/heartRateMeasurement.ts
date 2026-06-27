import type { WearableHeartRatePacket } from "@/modules/biofeedback/wearables/types";

export const HEART_RATE_SERVICE_UUID = "180D";
export const HEART_RATE_MEASUREMENT_CHARACTERISTIC_UUID = "2A37";

function fullUuid16(shortUuid: string): string {
  const normalized = shortUuid.replace(/-/g, "").toLowerCase();
  if (normalized.length === 4) {
    return `0000${normalized}-0000-1000-8000-00805f9b34fb`;
  }
  return shortUuid.toLowerCase();
}

export const HEART_RATE_SERVICE_UUID_FULL = fullUuid16(HEART_RATE_SERVICE_UUID);
export const HEART_RATE_MEASUREMENT_CHARACTERISTIC_UUID_FULL = fullUuid16(
  HEART_RATE_MEASUREMENT_CHARACTERISTIC_UUID,
);

function decodeBase64ToBytes(value: string): Uint8Array {
  const atobFn = globalThis.atob?.bind(globalThis);
  if (atobFn) {
    const binary = atobFn(value);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      out[index] = binary.charCodeAt(index);
    }
    return out;
  }

  const bufferCtor = (globalThis as { Buffer?: { from(input: string, encoding: string): Uint8Array } }).Buffer;
  if (bufferCtor?.from) {
    return Uint8Array.from(bufferCtor.from(value, "base64"));
  }

  throw new Error("Base64 decoder is unavailable in this runtime.");
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

export function normalizeBleUuid(uuid: string): string {
  return fullUuid16(uuid).toLowerCase();
}

export function hasHeartRateServiceUuid(serviceUuids: readonly string[] | null | undefined): boolean {
  if (!serviceUuids?.length) return false;
  return serviceUuids.some((uuid) => normalizeBleUuid(uuid) === HEART_RATE_SERVICE_UUID_FULL);
}

export function parseHeartRateMeasurement(base64Value: string): WearableHeartRatePacket {
  const bytes = decodeBase64ToBytes(base64Value);
  if (bytes.length === 0) {
    return {
      heartRateBpm: null,
      rrIntervalsMs: [],
      hasRrIntervals: false,
      sensorContactDetected: null,
      energyExpendedKj: null,
    };
  }

  const flags = bytes[0] ?? 0;
  const isUint16HeartRate = (flags & 0x01) !== 0;
  const sensorContactSupported = (flags & 0x04) !== 0;
  const sensorContactDetected = sensorContactSupported ? (flags & 0x02) !== 0 : null;
  const hasEnergyExpended = (flags & 0x08) !== 0;
  const hasRrIntervals = (flags & 0x10) !== 0;

  let offset = 1;
  let heartRateBpm: number | null = null;
  if (isUint16HeartRate) {
    if (bytes.length >= offset + 2) {
      heartRateBpm = readUint16Le(bytes, offset);
      offset += 2;
    }
  } else if (bytes.length > offset) {
    heartRateBpm = bytes[offset] ?? null;
    offset += 1;
  }

  let energyExpendedKj: number | null = null;
  if (hasEnergyExpended && bytes.length >= offset + 2) {
    energyExpendedKj = readUint16Le(bytes, offset);
    offset += 2;
  }

  const rrIntervalsMs: number[] = [];
  if (hasRrIntervals) {
    while (bytes.length >= offset + 2) {
      const rrRaw = readUint16Le(bytes, offset);
      offset += 2;
      rrIntervalsMs.push(Math.round((rrRaw / 1024) * 1000));
    }
  }

  return {
    heartRateBpm,
    rrIntervalsMs,
    hasRrIntervals,
    sensorContactDetected,
    energyExpendedKj,
  };
}
