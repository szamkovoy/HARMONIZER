/**
 * Центральный реестр оформительских токенов приложения.
 *
 * Задача этого модуля — сделать цвета, типографику и радиусы настраиваемыми в одном
 * месте, чтобы:
 *  - UI экранов и компонентов не угадывал оттенки (`#22c55e`, `rgba(30,32,38,0.92)` и т.д.),
 *    а ссылался на смысловые токены (`theme.colors.accent`, `theme.colors.dialogBg`);
 *  - редизайн сводился к правке одного места;
 *  - любое значение легко переопределить из `ThemeProvider` (для A/B или тем).
 *
 * Тема состоит из палитры (зависит от выбранной схемы: тёмная/светлая) и
 * топологии текста/радиусов/отступов (одинаковые для всех схем). Размеры/шрифты
 * намеренно **не зависят** от палитры — палитра управляет только цветами.
 */
import { createContext, useContext } from "react";
import type { TextStyle } from "react-native";

/** Настраиваемое семейство шрифта (пока — системный; оставляем поле для будущих Custom fonts). */
export type FontFamilyName = string | undefined;

export interface TypographyToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: TextStyle["fontWeight"];
  letterSpacing?: number;
  fontFamily?: FontFamilyName;
}

export interface TypographyTokens {
  /** Заголовки внутри модалок/экранов. */
  dialogTitle: TypographyToken;
  /** Основной текст в модалках/подсказках. */
  dialogBody: TypographyToken;
  /** Подписи крупных блоков (секции). */
  sectionTitle: TypographyToken;
  /** Текст кнопок. */
  buttonLabel: TypographyToken;
  /** Название экрана / практики. */
  screenTitle: TypographyToken;
  /** Подсказка под заголовком экрана. */
  screenHint: TypographyToken;
  /** Метка-пилюля (пульс/качество и т.п.). */
  statPillLabel: TypographyToken;
  /** Длинный статус (например, «Ожидание устойчивого сигнала…»). */
  inlineStatus: TypographyToken;
  /** Технический мелкий комментарий во время практики (debug/metrics). */
  technicalCaption: TypographyToken;
  /** Баннер-уведомление (оверлей в практике). */
  bannerMessage: TypographyToken;
  /** Вспомогательные цифры (таймеры и пр.). */
  numericLarge: TypographyToken;
}

export interface ColorTokens {
  /** Базовый фон экранов. */
  screenBg: string;
  /** Полупрозрачный затемняющий слой. */
  overlayDim: string;
  /** Фон всплывающих панелей и модалок (вот этот «тёмно-матовое стекло»). */
  surface: string;
  /** Чуть более светлая поверхность (например карточка диалога — слегка светлее мандалы). */
  surfaceElevated: string;
  /** Рамка у surface. */
  surfaceBorder: string;
  /** Акцент: прогресс, окружность таймера, «нормальное» значение параметра и пр. */
  accent: string;
  /** Тёмный контрастный текст поверх accent-цвета. */
  accentOnText: string;
  /** Основной текст (преимущественно белый). */
  textPrimary: string;
  /** Приглушённый второстепенный текст. */
  textMuted: string;
  /** Очень бледный/disabled текст. */
  textFaint: string;
  /** Цвет предупреждения/ошибки. */
  warning: string;
  /** Цвет ошибки (используется в PPG-баннерах). */
  danger: string;
  /** Фон круглой кнопки-иконки в панелях (крестик, +/-, цифра и т.п.). */
  controlButtonBg: string;
  /** Фон «прижатой» круглой кнопки. */
  controlButtonPressedBg: string;
  /** Цвет «основной» кнопки (primary). */
  buttonPrimaryBg: string;
  /** Цвет текста primary-кнопки. */
  buttonPrimaryFg: string;
  /** Цвет «второстепенной» кнопки (secondary). */
  buttonSecondaryBorder: string;
  /** Цвет текста secondary-кнопки. */
  buttonSecondaryFg: string;
  /** Backdrop под модалками. */
  modalBackdrop: string;
}

export interface RadiusTokens {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  pill: number;
  full: number;
}

export interface SpacingTokens {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

export type PaletteScheme = "dark" | "light";

export interface Theme {
  scheme: PaletteScheme;
  colors: ColorTokens;
  typography: TypographyTokens;
  radius: RadiusTokens;
  spacing: SpacingTokens;
  fontFamily: FontFamilyName;
}

/** Тёмная палитра. Используется как default (у мандалы / биофидбэка чёрный фон). */
const darkPalette: ColorTokens = {
  screenBg: "#07080c",
  overlayDim: "rgba(0,0,0,0.55)",
  surface: "rgba(30, 32, 38, 0.92)",
  surfaceElevated: "rgba(40, 44, 52, 0.96)",
  surfaceBorder: "rgba(255,255,255,0.07)",
  accent: "rgba(186, 230, 200, 0.92)",
  accentOnText: "#0b1e14",
  textPrimary: "#ffffff",
  textMuted: "#cbd5e1",
  textFaint: "#94a3b8",
  warning: "#fbbf24",
  danger: "#fca5a5",
  controlButtonBg: "rgba(255,255,255,0.08)",
  controlButtonPressedBg: "rgba(255,255,255,0.14)",
  buttonPrimaryBg: "#22c55e",
  buttonPrimaryFg: "#052e16",
  buttonSecondaryBorder: "rgba(255,255,255,0.16)",
  buttonSecondaryFg: "#e2e8f0",
  modalBackdrop: "rgba(2,6,23,0.78)",
};

/**
 * Светлая палитра. Предназначена для экранов со светлым контекстом (каталоги,
 * профиль, настройки). Цвета подобраны так, чтобы смысловые роли совпадали с тёмной
 * палитрой — компоненты одни и те же, меняется только схема.
 */
const lightPalette: ColorTokens = {
  screenBg: "#f8fafc",
  overlayDim: "rgba(15,23,42,0.08)",
  surface: "rgba(255,255,255,0.95)",
  surfaceElevated: "#ffffff",
  surfaceBorder: "rgba(15,23,42,0.08)",
  accent: "#1f8a4c",
  accentOnText: "#f8fafc",
  textPrimary: "#0f172a",
  textMuted: "#334155",
  textFaint: "#64748b",
  warning: "#b45309",
  danger: "#b91c1c",
  controlButtonBg: "rgba(15,23,42,0.06)",
  controlButtonPressedBg: "rgba(15,23,42,0.12)",
  buttonPrimaryBg: "#16a34a",
  buttonPrimaryFg: "#ffffff",
  buttonSecondaryBorder: "rgba(15,23,42,0.16)",
  buttonSecondaryFg: "#0f172a",
  modalBackdrop: "rgba(15,23,42,0.35)",
};

/** Базовая («dark») тема. Вся система берёт отсюда значения по умолчанию. */
export const defaultTheme: Theme = {
  scheme: "dark",
  fontFamily: undefined,
  colors: darkPalette,
  typography: {
    dialogTitle: { fontSize: 18, lineHeight: 24, fontWeight: "700" },
    dialogBody: { fontSize: 14, lineHeight: 20, fontWeight: "400" },
    sectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
    buttonLabel: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
    screenTitle: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
    screenHint: { fontSize: 15, lineHeight: 22, fontWeight: "400" },
    statPillLabel: { fontSize: 13, lineHeight: 18, fontWeight: "500" },
    inlineStatus: { fontSize: 15, lineHeight: 22, fontWeight: "500" },
    technicalCaption: { fontSize: 11, lineHeight: 16, fontWeight: "400" },
    bannerMessage: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
    numericLarge: { fontSize: 36, lineHeight: 40, fontWeight: "700" },
  },
  radius: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 20,
    pill: 999,
    full: 9999,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
};

/** Построение темы нужной схемы с сохранением единой топологии (размеры, радиусы, типографика). */
export function buildTheme(scheme: PaletteScheme): Theme {
  return {
    ...defaultTheme,
    scheme,
    colors: scheme === "light" ? lightPalette : darkPalette,
  };
}

/** Палитры доступны отдельно — для точечных переопределений в тестах/сторибуке. */
export const palettes = { dark: darkPalette, light: lightPalette } as const;

const ThemeContext = createContext<Theme>(defaultTheme);

export const ThemeProvider = ThemeContext.Provider;

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Утилита: собрать TextStyle из токена типографики (для прямой передачи в Text). */
export function textStyleFromToken(token: TypographyToken, color: string): TextStyle {
  return {
    color,
    fontSize: token.fontSize,
    lineHeight: token.lineHeight,
    fontWeight: token.fontWeight,
    letterSpacing: token.letterSpacing,
    fontFamily: token.fontFamily,
  };
}
