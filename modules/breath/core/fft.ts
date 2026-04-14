/**
 * Radix-2 Cooley–Tukey FFT. Длина n должна быть степенью двойки.
 * Возвращает [re, im] длины n.
 */
export function fftRadix2(inputRe: readonly number[], inputIm: readonly number[] | null): {
  re: number[];
  im: number[];
} {
  const n = inputRe.length;
  if ((n & (n - 1)) !== 0 || n < 2) {
    throw new Error("fftRadix2: length must be a power of 2 and >= 2");
  }

  const re = inputRe.slice();
  const im = inputIm ? inputIm.slice() : new Array(n).fill(0);

  let j = 0;
  for (let i = 1; i < n; i += 1) {
    let bit = n >>> 1;
    while (j & bit) {
      j ^= bit;
      bit >>>= 1;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >>> 1;
    const angle = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(angle);
    const wlenIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (j = 0; j < half; j += 1) {
        const k = i + j + half;
        const r0 = re[i + j]!;
        const i0 = im[i + j]!;
        const r1 = re[k]!;
        const i1 = im[k]!;
        const tr = wRe * r1 - wIm * i1;
        const ti = wRe * i1 + wIm * r1;
        re[i + j] = r0 + tr;
        im[i + j] = i0 + ti;
        re[k] = r0 - tr;
        im[k] = i0 - ti;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        const nextWIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
        wIm = nextWIm;
      }
    }
  }

  return { re, im };
}

/** Мощность |X|^2 для одностороннего спектра (k = 0..n/2-1), без нормализации на N (как относительное сравнение бинов в PDF). */
export function powerSpectrumMagnitudeSq(re: readonly number[], im: readonly number[]): number[] {
  const n = re.length;
  const half = n / 2;
  const out: number[] = [];
  for (let k = 0; k < half; k += 1) {
    const a = re[k]!;
    const b = im[k]!;
    out.push(a * a + b * b);
  }
  return out;
}

/** Ближайшая степень двойки >= n. */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) {
    p <<= 1;
  }
  return p;
}
