import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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

import type { AspectType, DailyForecast, Planet } from "@/modules/daily-engine";
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

type Windows = DailyForecast["windowsOfOpportunity"];

interface OpportunityWindowsProps {
  planetOfTheDay: Planet;
  /** Локальная дата прогноза (`YYYY-MM-DD`) — для согласования напоминаний после перезапуска. */
  forecastDate: string;
  windows: Windows;
  strings: HomeStrings;
  accessMode: AccessMode;
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
/** Высота точек волны (`waveDot`) — `top` совпадает с мат. Y, тело линии уходит вниз на эту величину. */
const WAVE_LINE_THICKNESS_PX = 4;
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
/** Половина «коробки» подписи маркера (колокольчик + время), пиксели — только для разведения текстов. */
const MARKER_LABEL_HALF_W_PX = 36;
/** Минимальный зазор между соседними подписями маркеров (край к краю), пиксели. */
const LABEL_GAP_PX = 10;
/**
 * Половина ширины колонки маркера (64px, margin −32): минимальный clamp центра к краю chartWrap,
 * чтобы колонка не обрезалась — без дополнительных «декоративных» отступов. То же для восхода, зенита и exactAspect.
 */
const MARKER_COLUMN_HALF_W_PX = 32;

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

  const sorted = [...slots].sort((a, b) => a.x - b.x);
  const centers = sorted.map((s) => {
    const ideal = s.x * width;
    const edge = MARKER_COLUMN_HALF_W_PX;
    return Math.min(width - edge, Math.max(edge, ideal));
  });

  const sep = (i: number, j: number) => sorted[i].halfWidthPx + sorted[j].halfWidthPx + LABEL_GAP_PX;

  for (let iter = 0; iter < 14; iter += 1) {
    for (let i = 1; i < sorted.length; i += 1) {
      const minC = centers[i - 1] + sep(i - 1, i);
      if (centers[i] < minC) centers[i] = minC;
    }
    for (let i = sorted.length - 2; i >= 0; i -= 1) {
      const maxC = centers[i + 1] - sep(i, i + 1);
      if (centers[i] > maxC) centers[i] = maxC;
    }
    for (let i = 0; i < sorted.length; i += 1) {
      const edge = MARKER_COLUMN_HALF_W_PX;
      centers[i] = Math.min(width - edge, Math.max(edge, centers[i]));
    }
  }

  sorted.forEach((s, i) => out.set(s.key, centers[i] / width));
  return out;
}

/** Горизонталь `left` точки/пунктира внутри маркера (px): центр точки на x·W, колонка центрирована на labelX·W. */
function markerPointLeftPx(chartW: number, x: number, labelX: number): number {
  if (!(chartW > 0)) return 0;
  return (x - labelX) * chartW + MARKER_COLUMN_HALF_W_PX;
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

const NOW_DASH_LEN = 2;
const NOW_DASH_GAP = 4;
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

function nowLineDashKeys(heightPx: number): number[] {
  const keys: number[] = [];
  for (let y = 0; y < heightPx; y += NOW_DASH_LEN + NOW_DASH_GAP) {
    keys.push(y);
  }
  return keys;
}

/** Доля суток 0…1 по локальному времени строки (без искусственного сжатия — совпадает с линией «сейчас»). */
function timeToDayFraction(time?: string): { x: number; past: boolean } | null {
  if (!time) return null;
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = date.getHours() * 60 + date.getMinutes();
  const x = Math.min(1, Math.max(0, minutes / 1440));
  return { x, past: date.getTime() < Date.now() };
}

function circularDelta(from: number, to: number): number {
  return to >= from ? to - from : to + 1 - from;
}

function makeSkyY(riseX: number | null, culminationX: number | null) {
  const amplitude = 42;
  const period = riseX != null && culminationX != null
    ? Math.max(0.45, Math.min(1.35, circularDelta(riseX, culminationX) * 4))
    : 1;
  const phaseRise = riseX ?? ((culminationX ?? 0.35) - period / 4 + 1) % 1;

  return (x: number) => {
    const elapsed = x - phaseRise;
    return SKY_AXIS_Y - Math.sin((elapsed / period) * Math.PI * 2) * amplitude;
  };
}

export function OpportunityWindows({
  planetOfTheDay,
  forecastDate,
  windows,
  strings,
  accessMode,
}: OpportunityWindowsProps) {
  const theme = useTheme();
  const [reminderTarget, setReminderTarget] = useState<WindowItem | null>(null);
  const [reminderMode, setReminderMode] = useState<"exact" | "before5">("exact");
  const [reminderTitleText, setReminderTitleText] = useState("");
  const [enabledReminders, setEnabledReminders] = useState<Record<string, "exact" | "before5">>({});
  const notificationIdsRef = useRef<Record<string, string>>({});
  /** Время DATE-триггера и момента окна — чтобы сбрасывать колокольчик без опроса ОС каждую секунду. */
  const reminderMetaRef = useRef<Record<string, OpportunityReminderMeta>>({});
  const enabledRemindersRef = useRef(enabledReminders);
  enabledRemindersRef.current = enabledReminders;
  /** Защита от гонки: отмена/сохранение инкрементит эпоху, async-синхронизация не затирает свежие правки. */
  const reminderSyncEpochRef = useRef(0);
  const [chartWidth, setChartWidth] = useState(0);
  const [nowBadgeLayoutW, setNowBadgeLayoutW] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const t = strings.opportunityWindows;
  const lineColor = PLANET_CHAKRA[planetOfTheDay].color;
  const enabledReminderKeysSig = useMemo(
    () => Object.keys(enabledReminders).sort().join(","),
    [enabledReminders],
  );
  useEffect(() => {
    const hasActiveReminder = enabledReminderKeysSig.length > 0;
    const tickMs = hasActiveReminder ? 15_000 : 30_000;
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, tickMs);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(new Date());
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [enabledReminderKeysSig]);

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
  const risePoint = timeToDayFraction(windows.sunrise?.time);
  const culminationPoint = timeToDayFraction(windows.culmination?.time);
  const skyY = useMemo(() => makeSkyY(risePoint?.x ?? null, culminationPoint?.x ?? null), [risePoint?.x, culminationPoint?.x]);
  const currentTimePoint = useMemo(() => {
    const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    // Доля суток без искусственного 0.02–0.98: у полуночи линия «сейчас» у реального правого края графика.
    const x = Math.min(1, Math.max(0, minutes / 1440));
    return {
      x,
      y: skyY(x),
      label: strings.formatTime(now.toISOString()),
    };
  }, [now, skyY, strings]);
  const yCurve = currentTimePoint.y;
  const yAxis = SKY_AXIS_Y;
  const { top: nowLineTop, height: nowLineHeight } = computeNowLineSpan(yCurve, yAxis);
  const nowLinePixelHeight = Math.max(1, Math.round(nowLineHeight));
  const gridLineMuted = useMemo(
    () => hexToRgba(theme.colors.textFaint, AXIS_LINE_OPACITY),
    [theme.colors.textFaint],
  );
  const nowDashYs = useMemo(() => nowLineDashKeys(nowLinePixelHeight), [nowLinePixelHeight]);
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
      const frac = timeToDayFraction(item.time);
      if (frac) {
        slots.push({ key: item.key, x: frac.x, halfWidthPx: MARKER_LABEL_HALF_W_PX });
      }
    }
    return slots;
  }, [activeItems]);

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
  const chartDots = Array.from({ length: 180 }, (_, index) => {
    const x = index / 179;
    return { x, y: skyY(x) };
  });
  const chartPoints = useMemo(
    () =>
      activeItems
        .map((item) => {
          const frac = timeToDayFraction(item.time);
          if (!frac) return null;
          const labelX = chartMarkerLabelXByKey.get(item.key) ?? frac.x;
          return {
            ...item,
            ...frac,
            y: skyY(frac.x),
            labelX,
          };
        })
        .filter((item): item is WindowItem & { x: number; y: number; past: boolean; labelX: number } => Boolean(item)),
    [activeItems, chartMarkerLabelXByKey, skyY],
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
      <View style={styles.header}>
        <AppText variant="sectionTitle">{t.title}</AppText>
        <AppText variant="technicalCaption" tone="muted">
          {t.subtitle(strings.planetLabels[planetOfTheDay])}
        </AppText>
      </View>

      <View style={styles.chartWrap} onLayout={onChartLayout}>
        <View style={[styles.axis, { backgroundColor: gridLineMuted }]} />
        <View
          pointerEvents="none"
          style={[
            styles.nowLine,
            {
              left: `${currentTimePoint.x * 100}%`,
              top: nowLineTop,
              height: nowLinePixelHeight,
              transform: [{ translateX: -0.5 }],
            },
          ]}
        >
          {nowDashYs.map((y) => (
            <View
              key={y}
              style={[
                styles.nowDashSegment,
                {
                  backgroundColor: gridLineMuted,
                  top: y,
                  height: Math.min(NOW_DASH_LEN, nowLinePixelHeight - y),
                },
              ]}
            />
          ))}
        </View>
        {chartDots.map((dot, index) => (
          <View
            key={index}
            style={[
              styles.waveDot,
              {
                backgroundColor: lineColor,
                left: `${dot.x * 100}%`,
                opacity: 0.18 + index / chartDots.length * 0.24,
                top: dot.y,
              },
            ]}
          />
        ))}
        {chartPoints.map((point) => {
          const reminderUiOn = Boolean(enabledReminders[point.key]) && !point.past;
          return (
          <Pressable
            key={point.key}
            disabled={point.past && !enabledReminders[point.key]}
            onPress={() => void toggleReminder(point)}
            style={[
              styles.marker,
              {
                left: `${point.labelX * 100}%`,
                opacity: point.past && !enabledReminders[point.key] ? 0.45 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.dash,
                {
                  borderColor: theme.colors.surfaceBorder,
                  left: markerPointLeftPx(chartWidth, point.x, point.labelX),
                  top: Math.min(point.y + 8, 78),
                },
              ]}
            />
            <View
              style={[
                styles.point,
                {
                  backgroundColor: lineColor,
                  left: markerPointLeftPx(chartWidth, point.x, point.labelX),
                  top: point.y,
                },
              ]}
            />
            <View style={styles.markerLabel}>
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
            </View>
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
  chartWrap: {
    height: 152,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  axis: {
    height: 1,
    left: 0,
    position: "absolute",
    right: 0,
    top: 78,
  },
  nowLine: {
    position: "absolute",
    width: 1,
    zIndex: 2,
  },
  nowDashSegment: {
    borderRadius: 0.5,
    left: 0,
    position: "absolute",
    width: 1,
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
  waveDot: {
    borderRadius: 999,
    height: 4,
    marginLeft: -2,
    position: "absolute",
    width: 4,
  },
  marker: {
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
  markerLabel: {
    alignItems: "center",
    bottom: 6,
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    position: "absolute",
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
  windowDetail: {
    lineHeight: 18,
  },
});
