import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Ionicons } from "@expo/vector-icons";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Line, Polyline } from "react-native-svg";

import { DateTime } from "luxon";

import type { AspectType, DailyForecast, Planet } from "@/modules/daily-engine";
import { dayFractionFromIso, interpolateDiurnalAltitude, samplePlanetAltitudeForDay } from "@/modules/daily-engine";
import type { AccessMode } from "@/services/globalContentClient";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { PLANET_CHAKRA } from "@/modules/home/planetChakra";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import {
  buildOpportunityAlarmStyleContent,
  getExpoNotificationsOrNull,
  OPPORTUNITY_REMINDERS_CHANNEL_ID,
} from "@/services/localNotifications";
import { loadOpportunityWindowsExplanation } from "@/services/opportunityWindowsExplanation";

type Windows = DailyForecast["windowsOfOpportunity"];

interface OpportunityWindowsProps {
  planetOfTheDay: Planet;
  /** Локальная дата прогноза (`YYYY-MM-DD`) — для согласования напоминаний после перезапуска. */
  forecastDate: string;
  windows: Windows;
  strings: HomeStrings;
  accessMode: AccessMode;
  userLocation: { lat: number; lng: number; timezone: string } | null;
}

type WindowItem = {
  key: "sunrise" | "culmination" | "exactAspect";
  title: string;
  time?: string;
  detail: string | null;
};

const REMINDER_NOTIFICATION_TITLE_MAX = 80;
const REMINDER_NOTIFICATION_BODY_MAX = 220;

/** Короткий заголовок уведомления по умолчанию: тип окна + планета из прогноза. */
function buildDefaultReminderTitle(item: WindowItem, windows: Windows, strings: HomeStrings): string {
  const wt = strings.opportunityWindows.windowTitles;
  const pl = strings.planetLabels;
  if (item.key === "sunrise" && windows.sunrise) {
    return `${wt.sunrise} ${pl[windows.sunrise.planet]}`.trim();
  }
  if (item.key === "culmination" && windows.culmination) {
    return `${wt.culmination} ${pl[windows.culmination.planet]}`.trim();
  }
  if (item.key === "exactAspect" && windows.exactAspect) {
    return `${wt.exactAspect} ${pl[windows.exactAspect.toNatalPlanet]}`.trim();
  }
  return item.title;
}

const SKY_AXIS_Y = 78;
/** Вертикальный масштаб: горизонт = ось, пик кульминации укладывается в эту амплитуду. */
const CHART_ALTITUDE_AMPLITUDE_PX = 42;
const CHART_VIEW_HEIGHT = 152;
/** Толщина линии графика (`Polyline` strokeWidth) — для отступа пунктира «сейчас». */
const WAVE_LINE_THICKNESS_PX = 3;
/** Воздух после нижнего края волны / перед верхним краём волны (не наезжаем на жёлтый/синий след). */
const NOW_AIR_AT_CURVE_PX = 3;
/** Воздух у горизонтальной оси (1px на `SKY_AXIS_Y`), не пересекаем линию. */
const NOW_AIR_AT_AXIS_PX = 2;
/** Высота строки «часы + время» у оси (оценка для позиции над/под линией). */
const AXIS_NOW_ROW_H = 22;
/** Зазор текста от горизонтальной оси, px. */
const AXIS_NOW_GAP = 3;
/** До первого onLayout бейджа — грубая оценка; после измерения используется фактическая ширина. */
const NOW_BADGE_FALLBACK_W = 72;
/** Оценка полу-ширины подписи маркера (колокольчик + время) до первого onLayout. */
const MARKER_LABEL_FALLBACK_HALF_W_PX = 28;
/** Минимальный зазор между соседними подписями маркеров (край к краю), пиксели. */
const LABEL_GAP_PX = 6;
/** Небольшой технический воздух у краёв графика для текстовых подписей. */
const LABEL_EDGE_GAP_PX = 2;
/** Половина hitbox зоны точки/пунктира: label живёт отдельно, поэтому её ширина не ограничивает край графика. */
const MARKER_HITBOX_HALF_W_PX = 32;

/**
 * После перезапуска окна пересчитываются/подтягиваются из кэша — ISO одного и того же момента
 * может чуть отличаться (мс, формат смещения). Строгое `===` ложно отменяло OS-напоминание и сбрасывало колокольчик.
 */
const REMINDER_EVENT_TIME_MATCH_MS = 120_000;

function coerceDataString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function opportunityWindowEventTimesMatch(stored: string | undefined, expected: string | undefined): boolean {
  if (!stored || !expected) return false;
  if (stored === expected) return true;
  const a = Date.parse(stored);
  const b = Date.parse(expected);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= REMINDER_EVENT_TIME_MATCH_MS;
}

/** Расписание expo-notifications для DATE-триггера при чтении из `getAllScheduledNotificationsAsync`. */
function getDateTriggerFireMs(trigger: unknown): number | null {
  if (trigger == null || typeof trigger !== "object") return null;
  const o = trigger as Record<string, unknown>;
  if (String(o.type).toLowerCase() !== "date") return null;
  const raw = o.date;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const p = Date.parse(raw);
    return Number.isNaN(p) ? null : p;
  }
  return null;
}

type OpportunityReminderMeta = { triggerAtMs: number; eventAtMs: number };

/**
 * Напоминание считается отработанным: время DATE-триггера или момента окна уже прошли.
 * Всегда сверяем с `eventIsoFallback` из текущего прогноза: если нативный триггер распарсился неверно,
 * «залипший» красный колокольчик всё равно сбросится, когда окно по данным графика уже в прошлом.
 */
function isOpportunityReminderConsumed(
  nowMs: number,
  meta: OpportunityReminderMeta | undefined,
  eventIsoFallback: string | undefined,
): boolean {
  if (meta) {
    if (meta.triggerAtMs <= nowMs) return true;
    if (meta.eventAtMs <= nowMs) return true;
  }
  if (eventIsoFallback) {
    const ev = Date.parse(eventIsoFallback);
    if (!Number.isNaN(ev) && ev <= nowMs) return true;
  }
  return false;
}

type ChartLabelSlot = { key: string; x: number; halfWidthPx: number };

type PositionedChartLabelSlot = ChartLabelSlot & { idealCenterPx: number };

function clampLabelCenterPx(width: number, centerPx: number, halfWidthPx: number): number {
  if (!(width > 0)) return centerPx;
  const edge = Math.max(halfWidthPx + LABEL_EDGE_GAP_PX, 1);
  return Math.min(width - edge, Math.max(edge, centerPx));
}

function clusterSpanWidthPx(slots: PositionedChartLabelSlot[]): number {
  if (slots.length === 0) return 0;
  let span = slots[0].halfWidthPx + slots[slots.length - 1].halfWidthPx;
  for (let i = 1; i < slots.length; i += 1) {
    span += slots[i - 1].halfWidthPx + slots[i].halfWidthPx + LABEL_GAP_PX;
  }
  return span;
}

function placeLabelCluster(width: number, slots: PositionedChartLabelSlot[]): number[] {
  if (slots.length === 0) return [];
  const span = clusterSpanWidthPx(slots);
  const desiredMid =
    slots.reduce((sum, slot) => sum + slot.idealCenterPx, 0) / Math.max(1, slots.length);
  const minMid = span / 2 + LABEL_EDGE_GAP_PX;
  const maxMid = width - span / 2 - LABEL_EDGE_GAP_PX;
  const clusterMid = maxMid >= minMid ? Math.min(maxMid, Math.max(minMid, desiredMid)) : width / 2;

  const centers: number[] = [];
  let current = clusterMid - span / 2 + slots[0].halfWidthPx;
  centers.push(current);
  for (let i = 1; i < slots.length; i += 1) {
    current += slots[i - 1].halfWidthPx + slots[i].halfWidthPx + LABEL_GAP_PX;
    centers.push(current);
  }
  return centers;
}

/**
 * Единый горизонтальный layout: возвращает labelX как долю ширины (0…1), центр подписи.
 * Точки на кривой остаются на своих x; смещаются только центры подписей.
 */
function layoutLabelCentersPx(width: number, slots: ChartLabelSlot[]): Map<string, number> {
  const out = new Map<string, number>();
  if (slots.length === 0) return out;
  if (!(width > 0)) {
    slots.forEach((s) => out.set(s.key, s.x));
    return out;
  }

  const sorted = [...slots]
    .sort((a, b) => a.x - b.x)
    .map<PositionedChartLabelSlot>((slot) => ({
      ...slot,
      idealCenterPx: clampLabelCenterPx(width, slot.x * width, slot.halfWidthPx),
    }));

  let clusters = sorted.map((slot) => [slot]);
  let placedClusters: Array<{ slots: PositionedChartLabelSlot[]; centers: number[] }> = [];

  for (let iter = 0; iter < Math.max(1, sorted.length); iter += 1) {
    placedClusters = clusters.map((cluster) => ({
      slots: cluster,
      centers: placeLabelCluster(width, cluster),
    }));

    let overlapAt = -1;
    for (let i = 1; i < placedClusters.length; i += 1) {
      const prev = placedClusters[i - 1];
      const next = placedClusters[i];
      const prevLastCenter = prev.centers[prev.centers.length - 1];
      const nextFirstCenter = next.centers[0];
      const minNextCenter =
        prevLastCenter +
        prev.slots[prev.slots.length - 1].halfWidthPx +
        next.slots[0].halfWidthPx +
        LABEL_GAP_PX;
      if (nextFirstCenter < minNextCenter - 0.1) {
        overlapAt = i;
        break;
      }
    }

    if (overlapAt === -1) break;

    clusters = [
      ...clusters.slice(0, overlapAt - 1),
      [...clusters[overlapAt - 1], ...clusters[overlapAt]],
      ...clusters.slice(overlapAt + 1),
    ];
  }

  placedClusters.forEach((cluster) => {
    cluster.slots.forEach((slot, index) => {
      out.set(slot.key, cluster.centers[index] / width);
    });
  });
  return out;
}

/**
 * Центр подписи «сейчас» по X: совпадает с долей текущего времени (пунктир), только clamp к краям chartWrap
 * по половине ширины бейджа (без учёта текстов окон внизу — другой вертикальный уровень).
 */
function clampNowLabelCenterX(chartW: number, nowFrac: number, badgeHalfPx: number): number {
  if (!(chartW > 0)) return nowFrac * chartW;
  const half = Math.max(badgeHalfPx, 1);
  const c = nowFrac * chartW;
  return Math.min(chartW - half, Math.max(half, c));
}

const AXIS_LINE_OPACITY = 0.52;

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function computeNowLineSpan(yCurve: number, yAxis: number): { top: number; height: number } {
  if (yCurve < yAxis) {
    const top = yCurve + WAVE_LINE_THICKNESS_PX + NOW_AIR_AT_CURVE_PX;
    const bottom = yAxis - NOW_AIR_AT_AXIS_PX;
    return { top, height: Math.max(0, bottom - top) };
  }
  const top = yAxis + 1 + NOW_AIR_AT_AXIS_PX;
  const bottom = yCurve - NOW_AIR_AT_CURVE_PX;
  return { top, height: Math.max(0, bottom - top) };
}

/** Доля суток 0…1 в IANA-зоне (та же шкала, что у `samplePlanetAltitudeForDay`). */
function timeToDayFraction(
  time: string | undefined,
  timezone: string,
): { x: number; past: boolean } | null {
  if (!time) return null;
  const x = dayFractionFromIso(time, timezone);
  if (x == null) return null;
  const eventMs = DateTime.fromISO(time, { zone: timezone }).toMillis();
  return { x, past: !Number.isNaN(eventMs) && eventMs < Date.now() };
}

function buildDiurnalChartModel(params: {
  planet: Planet;
  forecastDate: string;
  userLocation: { lat: number; lng: number; timezone: string };
}) {
  const samples = samplePlanetAltitudeForDay({
    planet: params.planet,
    forecastDate: params.forecastDate,
    userLocation: params.userLocation,
    steps: 96,
  });
  const maxAbs = Math.max(...samples.map((sample) => Math.abs(sample.altitude)), 0.08);
  const scale = CHART_ALTITUDE_AMPLITUDE_PX / maxAbs;
  const skyY = (x: number) => SKY_AXIS_Y - interpolateDiurnalAltitude(samples, x) * scale;
  const chartDots = samples.map((sample) => ({
    x: sample.x,
    y: skyY(sample.x),
  }));
  return { skyY, chartDots };
}

export function OpportunityWindows({
  planetOfTheDay,
  forecastDate,
  windows,
  strings,
  accessMode,
  userLocation,
}: OpportunityWindowsProps) {
  const theme = useTheme();
  const [reminderTarget, setReminderTarget] = useState<WindowItem | null>(null);
  const [reminderMode, setReminderMode] = useState<"exact" | "before5">("exact");
  const [reminderTitleText, setReminderTitleText] = useState("");
  const [enabledReminders, setEnabledReminders] = useState<Record<string, "exact" | "before5">>({});
  const [helpVisible, setHelpVisible] = useState(false);
  const [helpLoading, setHelpLoading] = useState(false);
  const [helpText, setHelpText] = useState<string | null>(null);
  const notificationIdsRef = useRef<Record<string, string>>({});
  /** Время DATE-триггера и момента окна — чтобы сбрасывать колокольчик без опроса ОС каждую секунду. */
  const reminderMetaRef = useRef<Record<string, OpportunityReminderMeta>>({});
  const enabledRemindersRef = useRef(enabledReminders);
  enabledRemindersRef.current = enabledReminders;
  /** Защита от гонки: отмена/сохранение инкрементит эпоху, async-синхронизация не затирает свежие правки. */
  const reminderSyncEpochRef = useRef(0);
  const [chartWidth, setChartWidth] = useState(0);
  const [markerLabelWidths, setMarkerLabelWidths] = useState<Record<string, number>>({});
  const [nowBadgeLayoutW, setNowBadgeLayoutW] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const t = strings.opportunityWindows;
  const graphPlanet = windows.sunrise?.planet ?? windows.culmination?.planet ?? planetOfTheDay;
  const lineColor = PLANET_CHAKRA[graphPlanet].color;
  const nowLineColor = useMemo(
    () => hexToRgba(theme.colors.textPrimary, 0.28),
    [theme.colors.textPrimary],
  );
  useEffect(() => {
    setNow(new Date());
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(new Date());
    });
    return () => {
      sub.remove();
    };
  }, []);

  /** Синхронизация колокольчиков с ОС и отмена устаревших напоминаний при смене суток/прогноза. */
  useEffect(() => {
    if (Platform.OS === "web") return;
    const notificationsApi = getExpoNotificationsOrNull();
    if (!notificationsApi) return;
    let cancelled = false;
    const expectedTimes: Record<WindowItem["key"], string | undefined> = {
      sunrise: windows.sunrise?.time,
      culmination: windows.culmination?.time,
      exactAspect: accessMode === "free" ? undefined : windows.exactAspect?.time,
    };

    void (async () => {
      const epochAtStart = reminderSyncEpochRef.current;
      try {
        const scheduled = await notificationsApi.getAllScheduledNotificationsAsync();
        if (cancelled || reminderSyncEpochRef.current !== epochAtStart) return;
        const nextEnabled: Record<string, "exact" | "before5"> = {};
        const nextIds: Record<string, string> = {};
        const nextMeta: Record<string, OpportunityReminderMeta> = {};
        const nowMs = Date.now();

        for (const req of scheduled) {
          const data = req.content.data as Record<string, unknown> | undefined;
          if (data?.source !== "home_opportunity_window" || typeof data.key !== "string") continue;
          const key = data.key as WindowItem["key"];
          const expected = expectedTimes[key];
          const storedDay = coerceDataString(data.forecastDate);
          if (storedDay && storedDay !== forecastDate) {
            await notificationsApi.cancelScheduledNotificationAsync(req.identifier).catch(() => undefined);
            continue;
          }
          const storedTime = coerceDataString(data.eventTimeIso);
          if (!storedTime || !expected || !opportunityWindowEventTimesMatch(storedTime, expected)) {
            await notificationsApi.cancelScheduledNotificationAsync(req.identifier).catch(() => undefined);
            continue;
          }
          const eventMs = Date.parse(storedTime);
          if (Number.isNaN(eventMs)) {
            await notificationsApi.cancelScheduledNotificationAsync(req.identifier).catch(() => undefined);
            continue;
          }
          const fireMs = getDateTriggerFireMs(req.trigger);
          const meta: OpportunityReminderMeta = {
            triggerAtMs: fireMs ?? eventMs,
            eventAtMs: eventMs,
          };
          if (isOpportunityReminderConsumed(nowMs, meta, expected)) {
            await notificationsApi.cancelScheduledNotificationAsync(req.identifier).catch(() => undefined);
            continue;
          }
          nextEnabled[key] = data.reminderMode === "before5" ? "before5" : "exact";
          nextIds[key] = req.identifier;
          nextMeta[key] = meta;
        }

        if (!cancelled && reminderSyncEpochRef.current === epochAtStart) {
          notificationIdsRef.current = nextIds;
          reminderMetaRef.current = nextMeta;
          setEnabledReminders(nextEnabled);
        }
      } catch {
        /* планировщик может быть недоступен в тестовой среде */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    accessMode,
    forecastDate,
    windows.sunrise?.time,
    windows.culmination?.time,
    windows.exactAspect?.time,
  ]);

  /**
   * Сброс красного колокольчика после наступления времени срабатывания или времени окна
   * (в т.ч. если телефон был выключен и локальное напоминание не показалось).
   */
  useEffect(() => {
    if (Platform.OS === "web") return;
    const notificationsApi = getExpoNotificationsOrNull();
    if (!notificationsApi) return;
    const expectedTimes: Record<WindowItem["key"], string | undefined> = {
      sunrise: windows.sunrise?.time,
      culmination: windows.culmination?.time,
      exactAspect: accessMode === "free" ? undefined : windows.exactAspect?.time,
    };

    void (async () => {
      const nowMs = Date.now();
      const enabled = enabledRemindersRef.current;
      const keys = Object.keys(enabled) as WindowItem["key"][];
      if (keys.length === 0) return;

      const keysToRemove: WindowItem["key"][] = [];
      for (const key of keys) {
        const meta = reminderMetaRef.current[key];
        const eventIso = expectedTimes[key];
        if (!isOpportunityReminderConsumed(nowMs, meta, eventIso)) continue;
        const id = notificationIdsRef.current[key];
        if (id) await notificationsApi.cancelScheduledNotificationAsync(id).catch(() => undefined);
        delete notificationIdsRef.current[key];
        delete reminderMetaRef.current[key];
        keysToRemove.push(key);
      }

      if (keysToRemove.length === 0) return;
      setEnabledReminders((prev) => {
        const next = { ...prev };
        for (const key of keysToRemove) delete next[key];
        return next;
      });
    })();
  }, [
    now,
    enabledReminders,
    accessMode,
    forecastDate,
    windows.sunrise?.time,
    windows.culmination?.time,
    windows.exactAspect?.time,
  ]);

  const items: Array<WindowItem | null> = [
    {
      key: "sunrise",
      title: t.windowTitles.sunrise,
      time: windows.sunrise?.time,
      detail: windows.sunrise ? t.sunriseDetail(strings.planetLabels[windows.sunrise.planet]) : null,
    },
    {
      key: "culmination",
      title: t.windowTitles.culmination,
      time: windows.culmination?.time,
      detail: windows.culmination ? t.culminationDetail(strings.planetLabels[windows.culmination.planet]) : null,
    },
    accessMode === "free"
      ? null
      : {
          key: "exactAspect",
          title: t.windowTitles.exactAspect,
          time: windows.exactAspect?.time,
          detail: windows.exactAspect
            ? t.exactAspectDetail(
                t.aspectLabels[windows.exactAspect.aspectType as AspectType],
                strings.planetLabels[windows.exactAspect.toNatalPlanet],
              )
            : null,
        },
  ];
  const displayItems = items.filter((item): item is WindowItem => Boolean(item));
  const activeItems = displayItems.filter((item) => item.time);
  const chartTimezone = userLocation?.timezone ?? "UTC";
  const diurnalChart = useMemo(() => {
    if (!userLocation) return null;
    return buildDiurnalChartModel({
      planet: graphPlanet,
      forecastDate,
      userLocation,
    });
  }, [forecastDate, graphPlanet, userLocation]);
  const skyY = diurnalChart?.skyY ?? (() => SKY_AXIS_Y);
  const chartDots = diurnalChart?.chartDots ?? [];
  const chartPolylinePoints = useMemo(() => {
    if (chartWidth <= 0 || chartDots.length < 2) return "";
    return chartDots
      .map((dot) => `${dot.x * chartWidth},${dot.y}`)
      .join(" ");
  }, [chartDots, chartWidth]);
  const currentTimePoint = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: chartTimezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const hour = Number(byType.hour);
    const minute = Number(byType.minute);
    const second = Number(byType.second);
    const minutes =
      (Number.isFinite(hour) ? hour : 0) * 60 +
      (Number.isFinite(minute) ? minute : 0) +
      (Number.isFinite(second) ? second : 0) / 60;
    const x = Math.min(1, Math.max(0, minutes / 1440));
    return {
      x,
      y: skyY(x),
      label: strings.formatTime(now.toISOString()),
    };
  }, [chartTimezone, now, skyY, strings]);
  const yCurve = currentTimePoint.y;
  const yAxis = SKY_AXIS_Y;
  const { top: nowLineTop, height: nowLineHeight } = computeNowLineSpan(yCurve, yAxis);
  const nowLinePixelHeight = Math.max(1, Math.round(nowLineHeight));
  const gridLineMuted = useMemo(
    () => hexToRgba(theme.colors.textFaint, AXIS_LINE_OPACITY),
    [theme.colors.textFaint],
  );
  // Подпись «сейчас» у горизонтали: кривая ниже оси → текст над осью; кривая над осью → текст под осью (меньше пересечений с волной).
  const nowAxisBadgeTop = useMemo(() => {
    if (yCurve > SKY_AXIS_Y) {
      return Math.max(2, SKY_AXIS_Y - AXIS_NOW_ROW_H - AXIS_NOW_GAP);
    }
    return Math.min(152 - AXIS_NOW_ROW_H - 2, SKY_AXIS_Y + AXIS_NOW_GAP);
  }, [yCurve]);

  const chartMarkerLabelSlots = useMemo((): ChartLabelSlot[] => {
    const slots: ChartLabelSlot[] = [];
    for (const item of activeItems) {
      const frac = timeToDayFraction(item.time, chartTimezone);
      if (frac) {
        const measuredWidth = markerLabelWidths[item.key];
        const timeLabel = item.time ? strings.formatTime(item.time) : "";
        const estimatedWidth = Math.max(
          MARKER_LABEL_FALLBACK_HALF_W_PX * 2,
          18 + timeLabel.length * 6,
        );
        slots.push({
          key: item.key,
          x: frac.x,
          halfWidthPx: (measuredWidth > 0 ? measuredWidth : estimatedWidth) / 2,
        });
      }
    }
    return slots;
  }, [activeItems, chartTimezone, markerLabelWidths, strings]);

  const chartMarkerLabelXByKey = useMemo(
    () => layoutLabelCentersPx(chartWidth, chartMarkerLabelSlots),
    [chartWidth, chartMarkerLabelSlots],
  );

  const onChartLayout = useCallback((event: LayoutChangeEvent) => {
    setChartWidth(event.nativeEvent.layout.width);
  }, []);

  const onNowBadgeLayout = useCallback((event: LayoutChangeEvent) => {
    const w = event.nativeEvent.layout.width;
    setNowBadgeLayoutW((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
  }, []);
  const onMarkerLabelLayout = useCallback((key: WindowItem["key"], width: number) => {
    setMarkerLabelWidths((prev) => {
      if (Math.abs((prev[key] ?? 0) - width) < 0.5) return prev;
      return { ...prev, [key]: width };
    });
  }, []);
  const chartPoints = useMemo(
    () =>
      activeItems
        .map((item) => {
          const frac = timeToDayFraction(item.time, chartTimezone);
          if (!frac) return null;
          const labelX = chartMarkerLabelXByKey.get(item.key) ?? frac.x;
          return {
            ...item,
            ...frac,
            y: skyY(frac.x),
            labelX,
            labelHalfWidthPx:
              (markerLabelWidths[item.key] ??
                Math.max(MARKER_LABEL_FALLBACK_HALF_W_PX * 2, 18 + strings.formatTime(item.time ?? "").length * 6)) / 2,
          };
        })
        .filter(
          (
            item,
          ): item is WindowItem & {
            x: number;
            y: number;
            past: boolean;
            labelX: number;
            labelHalfWidthPx: number;
          } => Boolean(item),
        ),
    [activeItems, chartMarkerLabelXByKey, chartTimezone, markerLabelWidths, skyY, strings],
  );

  const nowBadgeBodyHalfPx = (nowBadgeLayoutW > 0 ? nowBadgeLayoutW : NOW_BADGE_FALLBACK_W) / 2;
  const nowLabelCenterPx = useMemo(
    () => clampNowLabelCenterX(chartWidth, currentTimePoint.x, nowBadgeBodyHalfPx),
    [chartWidth, currentTimePoint.x, nowBadgeBodyHalfPx],
  );
  const nowLabelX = chartWidth > 0 ? nowLabelCenterPx / chartWidth : currentTimePoint.x;

  async function toggleReminder(item: WindowItem) {
    if (!item.time) return;
    if (enabledReminders[item.key]) {
      const notificationId = notificationIdsRef.current[item.key];
      const notificationsApi = getExpoNotificationsOrNull();
      if (notificationId && notificationsApi) {
        await notificationsApi.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
      }
      delete notificationIdsRef.current[item.key];
      delete reminderMetaRef.current[item.key];
      reminderSyncEpochRef.current += 1;
      setEnabledReminders((prev) => {
        const next = { ...prev };
        delete next[item.key];
        return next;
      });
      return;
    }
    setReminderMode("exact");
    setReminderTitleText(buildDefaultReminderTitle(item, windows, strings));
    setReminderTarget(item);
  }

  async function saveReminder() {
    if (!reminderTarget?.time) return;
    const eventDate = new Date(reminderTarget.time);
    const triggerDate = new Date(eventDate.getTime() - (reminderMode === "before5" ? 5 * 60_000 : 0));
    if (triggerDate.getTime() <= Date.now()) {
      Alert.alert(t.reminderPastTitle, t.reminderPastMessage);
      setReminderTarget(null);
      return;
    }

    const notificationsApi = getExpoNotificationsOrNull();
    if (!notificationsApi) {
      Alert.alert(t.reminderNotificationsUnavailableTitle, t.reminderNotificationsUnavailableMessage);
      return;
    }

    const permissions = await notificationsApi.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    const iosOk =
      permissions.ios?.status === notificationsApi.IosAuthorizationStatus.PROVISIONAL ||
      permissions.ios?.status === notificationsApi.IosAuthorizationStatus.AUTHORIZED;
    const allowed = permissions.granted || iosOk;
    if (!allowed) {
      Alert.alert(t.reminderNeedPermissionTitle, t.reminderNeedPermissionMessage);
      return;
    }

    const previousId = notificationIdsRef.current[reminderTarget.key];
    if (previousId) await notificationsApi.cancelScheduledNotificationAsync(previousId).catch(() => undefined);

    const androidChannelId = Platform.OS === "android" ? OPPORTUNITY_REMINDERS_CHANNEL_ID : undefined;

    const defaultTitle = buildDefaultReminderTitle(reminderTarget, windows, strings);
    const trimmedTitle = reminderTitleText.trim();
    const notificationTitle = (trimmedTitle.length > 0 ? trimmedTitle : defaultTitle).slice(
      0,
      REMINDER_NOTIFICATION_TITLE_MAX,
    );
    const timeStr = strings.formatTime(reminderTarget.time);
    const opener =
      reminderMode === "before5" ? `${t.reminderBodyFiveMinPrefix} ${timeStr}` : timeStr;
    const detailSuffix = reminderTarget.detail ? ` · ${reminderTarget.detail}` : "";
    const body = `${opener}${detailSuffix}`.replace(/\s+/g, " ").trim().slice(0, REMINDER_NOTIFICATION_BODY_MAX);

    const notificationId = await notificationsApi.scheduleNotificationAsync({
      content: buildOpportunityAlarmStyleContent({
        title: notificationTitle,
        body,
        data: {
          source: "home_opportunity_window",
          key: reminderTarget.key,
          reminderMode,
          forecastDate,
          eventTimeIso: reminderTarget.time,
          displayTitle: notificationTitle,
        },
      }),
      trigger: {
        type: notificationsApi.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
        ...(androidChannelId ? { channelId: androidChannelId } : {}),
      },
    });
    notificationIdsRef.current[reminderTarget.key] = notificationId;
    reminderMetaRef.current[reminderTarget.key] = {
      triggerAtMs: triggerDate.getTime(),
      eventAtMs: eventDate.getTime(),
    };
    reminderSyncEpochRef.current += 1;
    setEnabledReminders((prev) => ({ ...prev, [reminderTarget.key]: reminderMode }));
    setReminderTarget(null);
  }

  useEffect(() => {
    if (!helpVisible || helpText) return;
    let cancelled = false;
    setHelpLoading(true);
    void loadOpportunityWindowsExplanation({
      accessMode,
      planetOfTheDay,
      windows,
      strings,
    })
      .then((text) => {
        if (!cancelled) {
          setHelpText(text);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHelpLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessMode, helpText, helpVisible, planetOfTheDay, strings, windows]);

  useEffect(() => {
    setHelpText(null);
  }, [accessMode, planetOfTheDay, windows]);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.header}>
          <AppText variant="sectionTitle">{t.title}</AppText>
          <AppText variant="technicalCaption" tone="muted">
            {t.subtitle(strings.planetLabels[planetOfTheDay])}
          </AppText>
          {graphPlanet !== planetOfTheDay ? (
            <AppText variant="technicalCaption" tone="muted">
              {t.graphTrack(strings.planetLabels[graphPlanet])}
            </AppText>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.helpButtonAccessibilityLabel}
          onPress={() => setHelpVisible(true)}
          style={({ pressed }) => [
            styles.helpButton,
            {
              borderColor: theme.colors.surfaceBorder,
              backgroundColor: theme.colors.controlButtonBg,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          <Ionicons name="help-circle-outline" size={18} color={theme.colors.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.chartWrap} onLayout={onChartLayout}>
        <View style={[styles.axis, { backgroundColor: gridLineMuted }]} />
        {chartPolylinePoints ? (
          <Svg
            pointerEvents="none"
            width={chartWidth}
            height={CHART_VIEW_HEIGHT}
            style={styles.chartSvg}
          >
            {chartWidth > 0 && nowLinePixelHeight > 0 ? (
              <Line
                x1={currentTimePoint.x * chartWidth}
                y1={nowLineTop}
                x2={currentTimePoint.x * chartWidth}
                y2={nowLineTop + nowLinePixelHeight}
                stroke={nowLineColor}
                strokeWidth={1}
                strokeDasharray="2 4"
                strokeLinecap="round"
              />
            ) : null}
            <Polyline
              points={chartPolylinePoints}
              fill="none"
              stroke={lineColor}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.88}
            />
          </Svg>
        ) : null}
        {chartPoints.map((point) => {
          const reminderUiOn = Boolean(enabledReminders[point.key]) && !point.past;
          return (
            <Fragment key={point.key}>
              <Pressable
                disabled={point.past && !enabledReminders[point.key]}
                onPress={() => void toggleReminder(point)}
                style={[
                  styles.markerHitbox,
                  {
                    left: `${point.x * 100}%`,
                    opacity: point.past && !enabledReminders[point.key] ? 0.45 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.dash,
                    {
                      borderColor: theme.colors.surfaceBorder,
                      left: MARKER_HITBOX_HALF_W_PX,
                      top: Math.min(point.y + 8, 78),
                    },
                  ]}
                />
                <View
                  style={[
                    styles.point,
                    {
                      backgroundColor: lineColor,
                      left: MARKER_HITBOX_HALF_W_PX,
                      top: point.y,
                    },
                  ]}
                />
              </Pressable>
              <Pressable
                disabled={point.past && !enabledReminders[point.key]}
                onPress={() => void toggleReminder(point)}
                onLayout={(event) => onMarkerLabelLayout(point.key, event.nativeEvent.layout.width)}
                style={[
                  styles.markerLabelButton,
                  {
                    left: `${point.labelX * 100}%`,
                    marginLeft: -point.labelHalfWidthPx,
                    opacity: point.past && !enabledReminders[point.key] ? 0.45 : 1,
                  },
                ]}
              >
                <FontAwesome
                  name={reminderUiOn ? "bell" : "bell-o"}
                  size={13}
                  color={
                    reminderUiOn
                      ? theme.colors.danger
                      : point.past
                        ? theme.colors.textFaint
                        : theme.colors.textPrimary
                  }
                />
                <AppText variant="technicalCaption" tone={point.past ? "faint" : "primary"}>
                  {point.time ? strings.formatTime(point.time) : ""}
                </AppText>
              </Pressable>
            </Fragment>
          );
        })}
        <View
          pointerEvents="none"
          style={[
            styles.nowLineBadge,
            styles.nowBadgeRow,
            {
              backgroundColor: "transparent",
              left: `${nowLabelX * 100}%`,
              marginLeft: -nowBadgeBodyHalfPx,
              maxWidth: chartWidth > 0 ? chartWidth : undefined,
              top: nowAxisBadgeTop,
            },
          ]}
          onLayout={onNowBadgeLayout}
        >
          <Ionicons name="time-outline" size={12} color={theme.colors.textPrimary} />
          <AppText variant="technicalCaption" tone="primary">
            {currentTimePoint.label}
          </AppText>
        </View>
      </View>

      <View style={styles.windowList}>
        {displayItems.map((item) => (
          <View key={item.key} style={styles.windowLine}>
            <AppText variant="statPillLabel">{item.title}</AppText>
            <AppText variant="technicalCaption" tone="muted" style={styles.windowDetail}>
              {item.time ? `${strings.formatTime(item.time)} · ${item.detail}` : t.emptyDetail}
            </AppText>
          </View>
        ))}
      </View>
      <Modal animationType="fade" transparent visible={Boolean(reminderTarget)} onRequestClose={() => setReminderTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
            <AppText variant="sectionTitle">{t.reminderModalTitle}</AppText>
            {reminderTarget ? (
              <View style={styles.modalFieldBlock}>
                <AppText variant="screenHint">{t.reminderTextLabel}</AppText>
                <TextInput
                  value={reminderTitleText}
                  onChangeText={setReminderTitleText}
                  placeholder={buildDefaultReminderTitle(reminderTarget, windows, strings)}
                  placeholderTextColor={theme.colors.textFaint}
                  maxLength={REMINDER_NOTIFICATION_TITLE_MAX}
                  multiline={false}
                  autoCorrect
                  autoCapitalize="sentences"
                  style={[
                    styles.modalTextInput,
                    {
                      borderColor: theme.colors.surfaceBorder,
                      color: theme.colors.textPrimary,
                      backgroundColor: theme.colors.surface,
                    },
                  ]}
                />
              </View>
            ) : null}
            {(["exact", "before5"] as const).map((mode) => (
              <Pressable key={mode} style={styles.radioRow} onPress={() => setReminderMode(mode)}>
                <View style={[styles.radio, { borderColor: theme.colors.surfaceBorder }]}>
                  {reminderMode === mode ? <View style={[styles.radioDot, { backgroundColor: theme.colors.accent }]} /> : null}
                </View>
                <AppText variant="screenHint">{mode === "exact" ? t.reminderModeExact : t.reminderModeBefore5}</AppText>
              </Pressable>
            ))}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setReminderTarget(null)} style={styles.modalButton}>
                <AppText variant="buttonLabel">{t.reminderCancel}</AppText>
              </Pressable>
              <Pressable
                onPress={() => void saveReminder()}
                style={[styles.modalButton, { backgroundColor: theme.colors.buttonPrimaryBg }]}
              >
                <AppText variant="buttonLabel" tone="accentOn">
                  {t.reminderSave}
                </AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal animationType="fade" transparent visible={helpVisible} onRequestClose={() => setHelpVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
            <AppText variant="sectionTitle">{t.helpModalTitle}</AppText>
            {helpLoading ? (
              <View style={styles.helpLoading}>
                <ActivityIndicator size="small" color={theme.colors.accent} />
                <AppText variant="screenHint" tone="muted">
                  {t.helpLoading}
                </AppText>
              </View>
            ) : (
              <AppText variant="screenHint">{helpText ?? t.emptyDetail}</AppText>
            )}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setHelpVisible(false)} style={styles.modalButton}>
                <AppText variant="buttonLabel">{strings.closeButton}</AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 16,
  },
  header: {
    gap: 4,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  helpButton: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  chartWrap: {
    height: CHART_VIEW_HEIGHT,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  chartSvg: {
    left: 0,
    position: "absolute",
    top: 0,
  },
  axis: {
    height: 1,
    left: 0,
    position: "absolute",
    right: 0,
    top: 78,
  },
  nowLineBadge: {
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 2,
    paddingVertical: 3,
    position: "absolute",
    zIndex: 6,
  },
  nowBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    justifyContent: "center",
  },
  markerHitbox: {
    alignItems: "center",
    height: 148,
    marginLeft: -32,
    position: "absolute",
    top: 0,
    width: 64,
  },
  point: {
    borderRadius: 999,
    height: 12,
    marginLeft: -6,
    marginTop: -6,
    position: "absolute",
    width: 12,
  },
  dash: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    bottom: 68,
    position: "absolute",
  },
  markerLabelButton: {
    alignItems: "center",
    bottom: 6,
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    position: "absolute",
    zIndex: 4,
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.42)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    maxWidth: 360,
    padding: 18,
    width: "100%",
  },
  modalFieldBlock: {
    gap: 6,
  },
  modalTextInput: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 16,
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  radioRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingVertical: 4,
  },
  radio: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  radioDot: {
    borderRadius: 999,
    height: 12,
    width: 12,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    paddingTop: 4,
  },
  modalButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  helpLoading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  windowList: {
    gap: 8,
  },
  windowLine: {
    gap: 2,
  },
  windowDetail: {
    lineHeight: 18,
  },
});
