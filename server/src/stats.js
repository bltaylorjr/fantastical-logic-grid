// Statistics for the dashboard's reports, so small or noisy samples never
// read as findings (report.js, quality-puzzles.js, ratings.js).
//
//   wilson(k, n)          95% Wilson score interval for a proportion k of n:
//                         { p, low, high }. A flag uses `low`, so "40% gave up"
//                         from 2 of 5 games is not treated like 40 of 100.
//   bayesAverage(sum, n, prior, weight)
//                         an average pulled toward the overall average until
//                         it has enough values of its own (weight = how many
//                         values the prior counts as).
//   meanInterval(values)  mean and its 95% interval (t-based for small n).
//   median, quantile, mad (median absolute deviation), robustZ (modified
//   z-score, Iglewicz and Hoaglin: |z| > 3.5 is an outlier), winsorize
//   (clip to the given bounds before averaging).
export const Z95 = 1.959964;

export function wilson(k, n, z = Z95) {
  if (!n) return { p: null, low: 0, high: 1 };
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export function bayesAverage(sum, n, prior, weight = 5) {
  if (prior == null) return n ? sum / n : null;
  return (sum + prior * weight) / (n + weight);
}

// Student's t for 95%, two-sided, by degrees of freedom (1 to 30; then z).
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131,
  2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
export function meanInterval(values) {
  const n = values.length;
  if (!n) return { mean: null, low: null, high: null, n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, low: null, high: null, n };
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const t = n - 1 <= 30 ? T95[n - 2] : Z95;
  const half = (t * sd) / Math.sqrt(n);
  return { mean, low: mean - half, high: mean + half, n };
}

export function quantile(values, q) {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}
export const median = (values) => quantile(values, 0.5);

export function mad(values) {
  const m = median(values);
  if (m == null) return null;
  return median(values.map((x) => Math.abs(x - m)));
}

export function robustZ(x, values) {
  const m = median(values);
  const d = mad(values);
  if (m == null || !d) return 0;
  return (0.6745 * (x - m)) / d;
}

export const winsorize = (values, lo, hi) => values.map((x) => Math.min(hi, Math.max(lo, x)));
