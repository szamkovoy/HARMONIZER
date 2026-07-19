/**
 * MaskedTextInput — сегментный ввод по маске («DD-MM-YYYY», «HH:MM»).
 *
 * Каждый сегмент (DD | MM | YYYY, HH | MM) — отдельный TextInput.
 * Внутреннее состояние — фиксированная строка длины = число слотов; пустые
 * слоты хранятся как пробел. Поэтому правка «21» → «2» в дне даёт
 * «2_111968» (слоты: 2,∅,1,1,1,9,6,8), а не «2111968», где год съезжает в «968».
 *
 * При фокусе сегмент выделяется целиком (`selectTextOnFocus`) — ввод заново.
 * При заполнении фокус переходит на следующий сегмент.
 */
import { useMemo, useRef } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

const PLACEHOLDER_CHARS = new Set(["D", "M", "Y", "H"]);
const EMPTY = " ";

interface Segment {
  len: number;
  placeholder: string;
}
type Part = { type: "sep"; char: string } | { type: "seg"; seg: Segment; index: number };

function parseMask(mask: string): { segments: Segment[]; layout: Part[]; totalLen: number } {
  const segments: Segment[] = [];
  const layout: Part[] = [];
  let i = 0;
  while (i < mask.length) {
    if (PLACEHOLDER_CHARS.has(mask[i])) {
      let j = i;
      while (j < mask.length && PLACEHOLDER_CHARS.has(mask[j])) j++;
      const seg: Segment = { len: j - i, placeholder: mask.slice(i, j) };
      const index = segments.length;
      segments.push(seg);
      layout.push({ type: "seg", seg, index });
      i = j;
    } else {
      let j = i;
      while (j < mask.length && !PLACEHOLDER_CHARS.has(mask[j])) j++;
      layout.push({ type: "sep", char: mask.slice(i, j) });
      i = j;
    }
  }
  const totalLen = segments.reduce((s, seg) => s + seg.len, 0);
  return { segments, layout, totalLen };
}

/**
 * value → фиксированная строка слотов (пробел = пусто).
 * Если уже padded (длина = totalLen, только цифры/пробелы) — сохраняем позиции.
 * Иначе (начальная загрузка «21111968») — цифры слева, остальное пусто.
 */
function toSlots(value: string, totalLen: number): string {
  const raw = value ?? "";
  if (raw.length === totalLen && /^[\d ]*$/.test(raw)) {
    return raw;
  }
  const clean = raw.replace(/\D/g, "").slice(0, totalLen);
  return clean.padEnd(totalLen, EMPTY);
}

interface MaskedTextInputProps {
  mask: string;
  /** Строка цифр (может быть короче totalLen) или уже padded слоты. */
  value: string;
  onDigitsChange: (digits: string) => void;
  segmentStyle?: StyleProp<TextStyle>;
  separatorStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  keyboardType?: "default" | "numeric" | "number-pad" | "decimal-pad" | "phone-pad" | "email-address";
  editable?: boolean;
  placeholderTextColor?: string;
}

export function MaskedTextInput({
  mask,
  value,
  onDigitsChange,
  segmentStyle,
  separatorStyle,
  style,
  keyboardType = "number-pad",
  editable = true,
  placeholderTextColor,
}: MaskedTextInputProps) {
  const { segments, layout, totalLen } = useMemo(() => parseMask(mask), [mask]);
  const refs = useRef<(TextInput | null)[]>([]);
  const slots = toSlots(value, totalLen);

  const segmentOffset = (index: number): number => {
    let start = 0;
    for (let k = 0; k < index; k++) start += segments[k].len;
    return start;
  };

  const segmentValue = (index: number): string => {
    const start = segmentOffset(index);
    return slots
      .slice(start, start + segments[index].len)
      .replaceAll(EMPTY, "");
  };

  const onSegmentChange = (index: number, raw: string) => {
    const seg = segments[index];
    const digits = raw.replace(/\D/g, "").slice(0, seg.len);
    const start = segmentOffset(index);
    const next =
      slots.slice(0, start) +
      digits.padEnd(seg.len, EMPTY) +
      slots.slice(start + seg.len);
    // Наружу отдаём только цифры (без пробелов) — но позиции слотов
    // сохраняем через padded-строку в `value`, пока сегмент неполный:
    // если отдать «2111968», родитель снова сожмёт слоты. Поэтому
    // передаём padded (пробелы → остаются как не-цифры, родитель
    // должен хранить value as-is). Для совместимости: передаём
    // строку, где пустые слоты — пробел.
    onDigitsChange(next);
    if (digits.length === seg.len && index < segments.length - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  return (
    <View style={[styles.row, style]}>
      {layout.map((part, key) => {
        if (part.type === "sep") {
          return (
            <Text key={key} style={[styles.separator, separatorStyle]}>
              {part.char}
            </Text>
          );
        }
        const seg = part.seg;
        const idx = part.index;
        // Ширина с запасом под iOS selection-хэндлы (иначе «палочки с шариками» обрезаются).
        const width = seg.len * 14 + 12;
        return (
          <TextInput
            key={key}
            ref={(r) => {
              refs.current[idx] = r;
            }}
            value={segmentValue(idx)}
            onChangeText={(v) => onSegmentChange(idx, v)}
            placeholder={seg.placeholder}
            placeholderTextColor={placeholderTextColor}
            keyboardType={keyboardType}
            maxLength={seg.len}
            selectTextOnFocus
            editable={editable}
            style={[styles.segment, { width }, segmentStyle]}
          />
        );
      })}
    </View>
  );
}

/** Убрать пробелы-слоты → только цифры (для валидации/сохранения). */
export function maskDigitsOnly(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    // Не клипать selection-handles iOS (overflow:hidden часто приходит с borderRadius снаружи).
    overflow: "visible",
    minHeight: 28,
  },
  segment: {
    fontSize: 16,
    lineHeight: 22,
    // Достаточная высота, чтобы хэндлы выделения не выглядели «обрезанными».
    minHeight: 28,
    paddingVertical: 2,
    paddingHorizontal: 2,
    marginHorizontal: 0,
    textAlign: "center",
    includeFontPadding: false,
  },
  separator: {
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 2,
  },
});
