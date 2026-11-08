export const round1 = (n: number) => Math.round(n * 10) / 10;

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function weightedMean(parts: readonly { value: number | null; weight: number }[]): number | null {
  let sum = 0;
  let total = 0;
  for (const p of parts) {
    if (p.value === null || p.weight <= 0) continue;
    sum += p.value * p.weight;
    total += p.weight;
  }
  return total > 0 ? sum / total : null;
}

/** 1-5 分换算成 0-100 */
export const toHundred = (score: number) => ((score - 1) / 4) * 100;
