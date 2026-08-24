#!/usr/bin/env node
/**
 * Генератор binaural-loop'ов для мультиполосного кроссфейда.
 *
 * Модель (по исследованию «Алгоритм светозвуковой стимуляции мозга»):
 *   несущая f_carrier = 150 Гц (фиксированная, рекомендованная PDF база);
 *   для частоты биения b: левый канал = f_carrier − b/2, правый = f_carrier + b/2;
 *   beat ∈ {12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2.5, 2} Гц — покрывает диапазон
 *   targetHz (старт 12 Гц альфа → финиш 2 Гц дельта) с шагом ~1 Гц.
 *
 * Параметры WAV: 11050 Гц, Int16, stereo, 30.000 c. Все частоты кратны 0.25 Гц,
 * поэтому f × 30 c — целое число периодов → луп бесшовный (без щелчков на стыке).
 *
 * Почему 30 с (было 4 с): ExoPlayer `REPEAT_MODE_ONE` имеет микро-паузу на
 * стыке лупа — на 4с-лупе она слышна каждые 4 с («зацикленный фрагмент»,
 * фазовый скачок → «тональность чуть-чуть меняется»). 30с делает стык
 * редким (раз в 30 с) и на громкости 0.075 под дроном — практически
 * неслышным; медленная кроссфейд-протяжка частоты становится доминирующим
 * восприятием. 11050 Гц (вместо 22050) вдвое уменьшает бандл (15.9 МБ vs
 * 31.8 МБ) без потери качества: несущая 150 Гц = 73 сэмпла/период (гладко),
 * бинауральный эффект (разность L/R) не зависит от частоты дискретизации.
 * 30 с бесшовно для всех beat: 30 = 7.5 × 4, а 4 с уже бесшовно → любой
 * целый множитель 4 с тоже бесшовен (b × 4k = (b × 4) × k ∈ ℤ).
 *
 * Запуск: node scripts/generate-binaural-loops.mjs
 * Файлы пишутся в assets/audio/mandala-sound/binaural/beat-<b>.wav
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "assets", "audio", "mandala-sound", "binaural");

const SAMPLE_RATE = 11050;
const DURATION_SEC = 30;
const CARRIER_HZ = 150;
const AMPLITUDE = 0.8;

const BEATS = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2.5, 2];

function buildWav(leftHz, rightHz) {
  const totalSamples = SAMPLE_RATE * DURATION_SEC; // 88200
  const buf = Buffer.alloc(44 + totalSamples * 4);
  // RIFF header
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + totalSamples * 4, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 4, 28); // byte rate
  buf.writeUInt16LE(4, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(totalSamples * 4, 40);

  const maxInt16 = 32767;
  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / SAMPLE_RATE;
    const left = Math.sin(2 * Math.PI * leftHz * t) * AMPLITUDE;
    const right = Math.sin(2 * Math.PI * rightHz * t) * AMPLITUDE;
    buf.writeInt16LE(Math.round(left * maxInt16), 44 + i * 4);
    buf.writeInt16LE(Math.round(right * maxInt16), 44 + i * 4 + 2);
  }
  return buf;
}

function beatToFilename(beat) {
  // 2.5 → "2p5", чтобы имя было безопасным для require().
  const safe = String(beat).replace(".", "p");
  return `beat-${safe}.wav`;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const beat of BEATS) {
  const leftHz = CARRIER_HZ - beat / 2;
  const rightHz = CARRIER_HZ + beat / 2;
  const wav = buildWav(leftHz, rightHz);
  const filename = beatToFilename(beat);
  writeFileSync(join(OUT_DIR, filename), wav);
  console.log(`wrote ${filename}  (L=${leftHz} Hz, R=${rightHz} Hz, beat=${beat} Hz, ${wav.length} bytes)`);
}
console.log(`done: ${BEATS.length} loops in ${OUT_DIR}`);
