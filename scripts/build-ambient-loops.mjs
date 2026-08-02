#!/usr/bin/env node
/**
 * Cut source recordings and bake a seamless loop crossfade (default 5s).
 *
 * Output length = segmentLen - crossfade. The last `crossfade` seconds are an
 * equal-power blend of the segment end with the segment start, so native/player
 * loop (or dual-buffer handoff) does not dip to silence.
 *
 * Usage:
 *   node scripts/build-ambient-loops.mjs
 *   node scripts/build-ambient-loops.mjs --config assets/audio/ambient/sources.json
 *
 * Requires ffmpeg + ffprobe on PATH (or Homebrew /opt/homebrew/bin).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONFIG = path.join(ROOT, "assets/audio/ambient/sources.json");
const OUT_DIR = path.join(ROOT, "assets/audio/ambient");
/** Nature beds: longer blend hides evolving texture at the wrap. */
const CROSSFADE_SEC = 5;

function resolveBin(name) {
  for (const candidate of [
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ]) {
    const probe = spawnSync(candidate, ["-version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  throw new Error(`Missing ${name}. Install ffmpeg (brew install ffmpeg).`);
}

function run(bin, args, label) {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

function durationSec(ffprobe, file) {
  const result = run(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    `ffprobe ${file}`,
  );
  const value = Number.parseFloat(String(result.stdout).trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Bad duration for ${file}`);
  return value;
}

function buildOne(ffmpeg, ffprobe, entry) {
  const source = path.isAbsolute(entry.source)
    ? entry.source
    : path.join(ROOT, entry.source);
  if (!existsSync(source)) throw new Error(`Source missing: ${source}`);

  const total = durationSec(ffprobe, source);
  const from = Number(entry.fromSec ?? 0);
  const to = Number(entry.toSec ?? total);
  const xfade = Number(entry.crossfadeSec ?? CROSSFADE_SEC);
  if (!(to > from + xfade * 2 + 1)) {
    throw new Error(`${entry.id}: segment too short (need > ${xfade * 2 + 1}s), got ${to - from}`);
  }
  if (from < 0 || to > total + 0.25) {
    throw new Error(`${entry.id}: cut [${from},${to}) outside file duration ${total}`);
  }

  const segLen = to - from;
  const mainEnd = segLen - 2 * xfade;
  const outPath = path.join(OUT_DIR, `${entry.id}.m4a`);
  // Continuity: main ends at original[L-2C]; xf starts with original[L-2C:L-C]
  // blended into original[0:C]. Output length = L-C. No edge fades to silence.
  const filter = [
    `[0:a]atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS[seg]`,
    `[seg]asplit=3[a][b][c]`,
    `[a]atrim=0:${mainEnd.toFixed(3)},asetpts=PTS-STARTPTS[main]`,
    `[b]atrim=${mainEnd.toFixed(3)}:${(segLen - xfade).toFixed(3)},asetpts=PTS-STARTPTS[preEnd]`,
    `[c]atrim=0:${xfade.toFixed(3)},asetpts=PTS-STARTPTS[head]`,
    `[preEnd][head]acrossfade=d=${xfade}:c1=tri:c2=tri[xf]`,
    `[main][xf]concat=n=2:v=0:a=1[out]`,
  ].join(";");

  console.log(
    `→ ${entry.id}: ${source} [${from.toFixed(1)}…${to.toFixed(1)}] xfade=${xfade}s → ${path.relative(ROOT, outPath)} (≈${(segLen - xfade).toFixed(1)}s)`,
  );
  run(
    ffmpeg,
    [
      "-y",
      "-i",
      source,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outPath,
    ],
    `ffmpeg ${entry.id}`,
  );
}

function main() {
  const configPath = process.argv.includes("--config")
    ? path.resolve(process.argv[process.argv.indexOf("--config") + 1])
    : DEFAULT_CONFIG;
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const entries = Array.isArray(config.beds) ? config.beds : [];
  if (!entries.length) throw new Error(`No beds in ${configPath}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const ffmpeg = resolveBin("ffmpeg");
  const ffprobe = resolveBin("ffprobe");
  for (const entry of entries) buildOne(ffmpeg, ffprobe, entry);
  console.log(`Done: ${entries.length} ambient loops in ${path.relative(ROOT, OUT_DIR)}`);
}

main();
