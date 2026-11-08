import { useFocusEffect } from "@react-navigation/native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  InteractionManager,
  Linking,
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
import { computeMoonPhaseForLocalDay, dayFractionFromIso, interpolateDiurnalAltitude, samplePlanetAltitudeForDay } from "@/modules/daily-engine";
import type { AccessMode } from "@/services/globalContentClient";
import { fillHomeTemplate, type HomeStrings } from "@/modules/home/i18n/home";
import { PLANET_CHAKRA } from "@/modules/home/planetChakra";
import { useTranslate } from "@/modules/i18n";
import { useForegroundLocationPermission } from "@/modules/location/useForegroundLocationPermission";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { SurfaceCardHeader } from "@/modules/ui/SurfaceCardHeader";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { SurfaceHelpModal } from "@/modules/ui/SurfaceHelpModal";
import { useTheme } from "@/modules/ui/theme";
import { useAuth } from "@/modules/auth";
import { ensureNotificationPermission, registerPushToken } from "@/modules/notifications";
import { ensureAndroidExactAlarmsForOpportunityReminders } from "@/services/androidExactAlarms";
import {
  buildOpportunityAlarmStyleContent,
  ensureAndroidNotificationChannels,
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
  /** After the user grants location from the in-card CTA — reload day content. */
  onLocationGranted?: () => void;
}

type WindowItem = {
  key: "sunrise" | "culmination" | "exactAspect" | "moonPhaseNew" | "moonPhaseFull";
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
  if (item.key === "moonPhaseNew" || item.key === "moonPhaseFull") {
    return item.title;
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
/** Половина hitbox зоны точки/пунктира: точка на кривой имеет отдельный hitbox. */
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
 * Сколько держать OS-alarm после времени окна, даже если triggerAt уже в прошлом.
 * На Android без exact-alarm Doze может доставить уведомление с большой задержкой;
 * ранняя cancel в sync убивала ещё живой PendingIntent (пропуск / «не сработало»).
 */
const OPPORTUNITY_REMINDER_LATE_DELIVERY_GRACE_MS = 3 * 60 * 60 * 1000;

/**
 * Напоминание считается отработанным для UI: время DATE-триггера или момента окна уже прошли.
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

/** Можно ли снять OS-расписание: только после grace (или если время окна неизвестно/битое). */
function shouldCancelStaleOpportunityOsAlarm(
  nowMs: number,
  meta: OpportunityReminderMeta | undefined,
  eventIsoFallback: string | undefined,
): boolean {
  const eventMs =
    meta?.eventAtMs ??
    (eventIsoFallback ? Date.parse(eventIsoFallback) : Number.NaN);
  if (!Number.isFinite(eventMs)) return true;
  return nowMs > eventMs + OPPORTUNITY_REMINDER_LATE_DELIVERY_GRACE_MS;
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
  onLocationGranted,
}: OpportunityWindowsProps) {
  const theme = useTheme();
  const { authUser } = useAuth();
  const { t: tCatalog } = useTranslate();
  const { status: locationStatus, request: requestLocationPermission, recheck: recheckLocationPermission } =
    useForegroundLocationPermission({
      onGranted: onLocationGranted,
      userId: authUser?.id,
    });
  useFocusEffect(
    useCallback(() => {
      recheckLocationPermission();
    }, [recheckLocationPermission]),
  );
  const showGraph = locationStatus === "granted";
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
  /** Не даём повторно жать «Сохранить», пока идёт запрос разрешения / schedule. */
  const reminderSavingRef = useRef(false);
  const [chartWidth, setChartWidth] = useState(0);
  const [nowBadgeLayoutW, setNowBadgeLayoutW] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const t = strings.opportunityWindows;
  const graphPlanet = windows.sunrise?.planet ?? windows.culmination?.planet ?? planetOfTheDay;
  const lineColor = PLANET_CHAKRA[graphPlanet].color;
  const nowLineColor = useMemo(
    () => hexToRgba(theme.colors.textPrimary, 0.28),
    [theme.colors.textPrimary],
  );
  const chartTimezone = userLocation?.timezone ?? "UTC";
  /**
   * Новолуние/полнолуние — глобальный момент (не зависит от lat/lng), только
   * timezone решает, попадает ли он в текущие локальные сутки пользователя.
   * Считается на клиенте (общая эфемерида с кривой). Включено в общий список
   * `displayItems`, чтобы получить колокольчик-напоминание единообразно с другими
   * окнами, но без точки на кривой (сизигия не лежит на суточной кривой планеты дня).
   */
  const moonPhase = useMemo(
    () => computeMoonPhaseForLocalDay({ forecastDate, timezone: chartTimezone }),
    [forecastDate, chartTimezone],
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
      moonPhaseNew: moonPhase?.kind === "new" ? moonPhase.time : undefined,
      moonPhaseFull: moonPhase?.kind === "full" ? moonPhase.time : undefined,
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
            // UI сбросим ниже (не кладём в nextEnabled). OS-alarm не трогаем,
            // пока не вышел late-delivery grace — иначе Doze-задержка + sync = пропуск.
            if (shouldCancelStaleOpportunityOsAlarm(nowMs, meta, expected)) {
              await notificationsApi.cancelScheduledNotificationAsync(req.identifier).catch(() => undefined);
            }
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
    moonPhase?.kind,
    moonPhase?.time,
  ]);

  /**
   * Сброс красного колокольчика после наступления времени срабатывания или времени окна.
   * OS-расписание не отменяем здесь: на Android inexact/Doze может доставить позже;
   * cancel делал sync / toggle / grace.
   */
  useEffect(() => {
    if (Platform.OS === "web") return;
    const expectedTimes: Record<WindowItem["key"], string | undefined> = {
      sunrise: windows.sunrise?.time,
      culmination: windows.culmination?.time,
      exactAspect: accessMode === "free" ? undefined : windows.exactAspect?.time,
      moonPhaseNew: moonPhase?.kind === "new" ? moonPhase.time : undefined,
      moonPhaseFull: moonPhase?.kind === "full" ? moonPhase.time : undefined,
    };

    const nowMs = Date.now();
    const enabled = enabledRemindersRef.current;
    const keys = Object.keys(enabled) as WindowItem["key"][];
    if (keys.length === 0) return;

    const keysToRemove: WindowItem["key"][] = [];
    for (const key of keys) {
      const meta = reminderMetaRef.current[key];
      const eventIso = expectedTimes[key];
      if (!isOpportunityReminderConsumed(nowMs, meta, eventIso)) continue;
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
  }, [
    now,
    enabledReminders,
    accessMode,
    forecastDate,
    windows.sunrise?.time,
    windows.culmination?.time,
    windows.exactAspect?.time,
    moonPhase?.kind,
    moonPhase?.time,
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
    accessMode === "free" || !windows.exactAspect
      ? null
      : {
          key: "exactAspect",
          title: t.windowTitles.exactAspect,
          time: windows.exactAspect.time,
          detail: t.exactAspectDetail(
            t.aspectLabels[windows.exactAspect.aspectType as AspectType],
            strings.planetLabels[windows.exactAspect.transitPlanet ?? graphPlanet],
            strings.planetLabels[windows.exactAspect.toNatalPlanet],
          ),
        },
    moonPhase
      ? {
          key: moonPhase.kind === "new" ? "moonPhaseNew" : "moonPhaseFull",
          title: moonPhase.kind === "new" ? t.windowTitles.moonPhaseNew : t.windowTitles.moonPhaseFull,
          time: moonPhase.time,
          detail: t.moonPhaseDetail,
        }
      : null,
  ];
  const displayItems = items.filter((item): item is WindowItem => Boolean(item));
  // Точки на кривой — только для окон, привязанных к суточной кривой планеты дня.
  // Сизигия (новолуние/полнолуние) глобальна и на кривой не отображается.
  const activeItems = displayItems.filter(
    (item) => item.time && item.key !== "moonPhaseNew" && item.key !== "moonPhaseFull",
  );
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

  /**
   * Состояние «момент уже прошёл» для каждой строки списка (колокольчик седеет
   * после наступления события). Считается той же `timeToDayFraction`, что и точки
   * на кривой, но отдельно — потому что луна не входит в `activeItems` (нет точки
   * на графике), а `past` для её строки нужен.
   */
  const pastByKey = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const item of displayItems) {
      if (!item.time) continue;
      const frac = timeToDayFraction(item.time, chartTimezone);
      if (frac) map[item.key] = frac.past;
    }
    return map;
  }, [displayItems, chartTimezone]);

  const onChartLayout = useCallback((event: LayoutChangeEvent) => {
    setChartWidth(event.nativeEvent.layout.width);
  }, []);

  const onNowBadgeLayout = useCallback((event: LayoutChangeEvent) => {
    const w = event.nativeEvent.layout.width;
    setNowBadgeLayoutW((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
  }, []);
  const chartPoints = useMemo(
    () =>
      activeItems
        .map((item) => {
          const frac = timeToDayFraction(item.time, chartTimezone);
          if (!frac) return null;
          return {
            ...item,
            ...frac,
            y: skyY(frac.x),
          };
        })
        .filter(
          (item): item is WindowItem & {
            x: number;
            y: number;
            past: boolean;
          } => Boolean(item),
        ),
    [activeItems, chartTimezone, skyY],
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
    if (!reminderTarget?.time || reminderSavingRef.current) return;
    const pendingTarget = reminderTarget;
    const pendingMode = reminderMode;
    const pendingTitleText = reminderTitleText;
    const eventDate = new Date(pendingTarget.time);
    const triggerDate = new Date(eventDate.getTime() - (pendingMode === "before5" ? 5 * 60_000 : 0));
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

    reminderSavingRef.current = true;
    // Закрываем модалку до системного диалога: на Android permission sheet
    // поверх RN Modal часто не показывается / сразу denied → цикл «Уведомить»↔Alert.
    setReminderTarget(null);
    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });
    if (Platform.OS === "android") {
      await new Promise((resolve) => setTimeout(resolve, 160));
    }

    try {
      const perm = await ensureNotificationPermission("opportunity_bell");
      if (perm !== "granted") {
        const appName = tCatalog("common.appName");
        Alert.alert(
          t.reminderNeedPermissionTitle,
          fillHomeTemplate(t.reminderNeedPermissionMessage, { appName }),
          [
            { text: t.reminderCancel, style: "cancel" },
            {
              text: strings.openSettingsButton,
              onPress: () => void Linking.openSettings(),
            },
          ],
        );
        return;
      }
      // Same contract as Home / webinar: OS grant → claim Expo token for remote admin pushes.
      if (authUser?.id) void registerPushToken(authUser.id);

      if (Platform.OS === "android") {
        try {
          await ensureAndroidNotificationChannels();
        } catch {
          Alert.alert(t.reminderNotificationsUnavailableTitle, t.reminderNotificationsUnavailableMessage);
          return;
        }
        const appName = tCatalog("common.appName");
        const exactOk = await ensureAndroidExactAlarmsForOpportunityReminders({
          title: t.reminderExactAlarmTitle,
          message: fillHomeTemplate(t.reminderExactAlarmMessage, { appName }),
          openSettingsLabel: strings.openSettingsButton,
          cancelLabel: t.reminderCancel,
        });
        if (!exactOk) return;
      }

      const previousId = notificationIdsRef.current[pendingTarget.key];
      if (previousId) await notificationsApi.cancelScheduledNotificationAsync(previousId).catch(() => undefined);

      const androidChannelId = Platform.OS === "android" ? OPPORTUNITY_REMINDERS_CHANNEL_ID : undefined;

      const defaultTitle = buildDefaultReminderTitle(pendingTarget, windows, strings);
      const trimmedTitle = pendingTitleText.trim();
      const notificationTitle = (trimmedTitle.length > 0 ? trimmedTitle : defaultTitle).slice(
        0,
        REMINDER_NOTIFICATION_TITLE_MAX,
      );
      const timeStr = strings.formatTime(pendingTarget.time);
      const opener =
        pendingMode === "before5" ? `${t.reminderBodyFiveMinPrefix} ${timeStr}` : timeStr;
      const detailSuffix = pendingTarget.detail ? ` · ${pendingTarget.detail}` : "";
      const body = `${opener}${detailSuffix}`.replace(/\s+/g, " ").trim().slice(0, REMINDER_NOTIFICATION_BODY_MAX);

      const notificationId = await notificationsApi.scheduleNotificationAsync({
        content: buildOpportunityAlarmStyleContent({
          title: notificationTitle,
          body,
          data: {
            source: "home_opportunity_window",
            key: pendingTarget.key,
            reminderMode: pendingMode,
            forecastDate,
            eventTimeIso: pendingTarget.time,
            displayTitle: notificationTitle,
          },
        }),
        trigger: {
          type: notificationsApi.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
          ...(androidChannelId ? { channelId: androidChannelId } : {}),
        },
      });
      notificationIdsRef.current[pendingTarget.key] = notificationId;
      reminderMetaRef.current[pendingTarget.key] = {
        triggerAtMs: triggerDate.getTime(),
        eventAtMs: eventDate.getTime(),
      };
      reminderSyncEpochRef.current += 1;
      setEnabledReminders((prev) => ({ ...prev, [pendingTarget.key]: pendingMode }));
    } finally {
      reminderSavingRef.current = false;
    }
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
  }, [accessMode, planetOfTheDay, strings.locale, windows]);

  return (
    <>
      <SurfaceCardView style={styles.card}>
      <SurfaceCardHeader
        title={t.title}
        help={
          showGraph
            ? {
                accessibilityLabel: t.helpButtonAccessibilityLabel,
                onPress: () => setHelpVisible(true),
              }
            : undefined
        }
      >
        {showGraph ? (
          <AppText variant="screenHint" tone="muted">
            {accessMode === "free"
              ? t.subtitle(strings.planetLabels[planetOfTheDay])
              : t.paidIntro(
                  strings.planetLabels[planetOfTheDay],
                  strings.planetLabels[graphPlanet],
                )}
          </AppText>
        ) : null}
      </SurfaceCardHeader>

      {locationStatus === "checking" ? (
        <View style={styles.locationPrompt}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : locationStatus === "denied" ? (
        <View style={styles.locationPrompt}>
          <AppText variant="screenHint" tone="muted" style={styles.locationPromptText}>
            {tCatalog("home.opportunityWindows.needLocation")}
          </AppText>
          <AppButton
            label={tCatalog("home.opportunityWindows.enableLocationButton")}
            onPress={() => void requestLocationPermission()}
          />
        </View>
      ) : (
        <>
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
          return (
            <Pressable
              key={point.key}
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
        {displayItems.map((item) => {
          const time = item.time;
          const hasTime = Boolean(time);
          const past = pastByKey[item.key] ?? false;
          const reminderUiOn = Boolean(enabledReminders[item.key]) && !past;
          const disabled = !hasTime || (past && !enabledReminders[item.key]);
          return (
            <Pressable
              key={item.key}
              disabled={disabled}
              onPress={hasTime ? () => void toggleReminder(item) : undefined}
              style={[styles.windowLine, { opacity: disabled ? 0.45 : 1 }]}
            >
              <AppText variant="statPillLabel" style={styles.windowTitle}>
                {item.title}
              </AppText>
              <View style={styles.windowDetailRow}>
                {hasTime ? (
                  <FontAwesome
                    name={reminderUiOn ? "bell" : "bell-o"}
                    size={12}
                    color={
                      reminderUiOn
                        ? theme.colors.danger
                        : past
                          ? theme.colors.textFaint
                          : theme.colors.textPrimary
                    }
                  />
                ) : null}
                <AppText
                  variant="technicalCaption"
                  tone={past ? "faint" : "muted"}
                  style={styles.windowDetail}
                >
                  {time ? `${strings.formatTime(time)} · ${item.detail}` : t.emptyDetail}
                </AppText>
              </View>
            </Pressable>
          );
        })}
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
        </>
      )}
      </SurfaceCardView>
      <SurfaceHelpModal
        visible={helpVisible}
        title={t.helpModalTitle}
        closeLabel={strings.closeButton}
        onClose={() => setHelpVisible(false)}
        loading={helpLoading}
        loadingLabel={t.helpLoading}
        body={helpText ?? t.emptyDetail}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 22,
    gap: 14,
  },
  locationPrompt: {
    alignItems: "center",
    gap: 16,
    paddingVertical: 12,
  },
  locationPromptText: {
    textAlign: "center",
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
  windowDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
  windowList: {
    gap: 8,
  },
  windowLine: {
    gap: 2,
  },
  windowTitle: {
    lineHeight: 18,
    minHeight: 18,
  },
  windowDetail: {
    lineHeight: 18,
  },
});
