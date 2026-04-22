import { getReference, type LmsRow } from "./references";

export type Sex = "boy" | "girl";
export type MeasurementType = "weight" | "height";
export type Standard = "auto" | "who" | "cdc";
export type ResolvedStandard = "who" | "cdc";

export const ALLOWED_PERCENTILES = [3, 5, 10, 25, 50, 75, 90, 95, 97] as const;

export interface MeasurementInput {
  sex: Sex;
  birthDate: Date;
  measurementDate: Date;
  measurementType: MeasurementType;
  value: number;
  standard: Standard;
}

export interface MeasurementResult {
  sex: Sex;
  birthDate: string;
  measurementDate: string;
  ageMonths: number;
  measurementType: MeasurementType;
  measurementLabel: string;
  value: number;
  unit: "kg" | "cm";
  zscore: number;
  percentile: number;
  standardRequested: Standard;
  standardUsed: ResolvedStandard;
  chartKind: string;
  L: number;
  M: number;
  S: number;
  table: LmsRow[];
}

export function parseDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function ageInMonths(birth: Date, measured: Date): number {
  const days = (measured.getTime() - birth.getTime()) / 86_400_000;
  if (days < 0) throw new Error("measurement_date must be on or after birth_date");
  return days / 30.4375;
}

export function resolvedStandard(requested: Standard, ageMonths: number): ResolvedStandard {
  if (requested === "auto") return ageMonths < 24 ? "who" : "cdc";
  return requested;
}

function whoChartKind(type: MeasurementType, ageMonths: number): string {
  if (type === "weight") return "weight-for-age";
  return ageMonths < 24 ? "length-for-age" : "height-for-age";
}

function cdcChartKind(type: MeasurementType, ageMonths: number): string {
  if (type === "weight") return "weight-for-age";
  return ageMonths < 24 ? "length-for-age" : "stature-for-age";
}

export function interpolateLms(rows: LmsRow[], ageMonths: number): { L: number; M: number; S: number } {
  const minAge = rows[0].month;
  const maxAge = rows[rows.length - 1].month;
  if (ageMonths < minAge || ageMonths > maxAge) {
    throw new Error(
      `Age ${ageMonths.toFixed(2)} months is outside the supported range ${minAge.toFixed(1)}-${maxAge.toFixed(1)} months for this reference.`,
    );
  }
  let lo = 0;
  let hi = rows.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].month <= ageMonths) lo = mid;
    else hi = mid;
  }
  const a = rows[lo];
  const b = rows[hi];
  if (a.month === b.month) return { L: a.L, M: a.M, S: a.S };
  const t = (ageMonths - a.month) / (b.month - a.month);
  return {
    L: a.L + t * (b.L - a.L),
    M: a.M + t * (b.M - a.M),
    S: a.S + t * (b.S - a.S),
  };
}

export function zscoreFromMeasurement(value: number, L: number, M: number, S: number): number {
  if (value <= 0) throw new Error("measurement value must be positive");
  if (Math.abs(L) < 1e-8) return Math.log(value / M) / S;
  return (Math.pow(value / M, L) - 1) / (L * S);
}

export function measurementForZscore(L: number, M: number, S: number, z: number): number {
  if (Math.abs(L) < 1e-8) return M * Math.exp(S * z);
  const base = 1 + L * S * z;
  if (base <= 0) return NaN;
  return M * Math.pow(base, 1 / L);
}

// Abramowitz & Stegun 26.2.17 rational approximation
function erf(x: number): number {
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Beasley-Springer-Moro inverse CDF
export function normalInvCdf(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("p must be in (0,1)");
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  q = p - 0.5;
  r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

export function percentileFromZscore(z: number): number {
  return 100 * normalCdf(z);
}

export function percentileCurve(rows: LmsRow[], percentile: number, ages: number[]): number[] {
  const z = normalInvCdf(percentile / 100);
  return ages.map((a) => {
    const { L, M, S } = interpolateLms(rows, a);
    return measurementForZscore(L, M, S, z);
  });
}

export function referenceTable(
  sex: Sex,
  measurementType: MeasurementType,
  ageMonths: number,
  standard: Standard,
): { rows: LmsRow[]; actual: ResolvedStandard; chartKind: string } {
  const actual = resolvedStandard(standard, ageMonths);
  if (actual === "who" && ageMonths > 60) {
    throw new Error("WHO references in this app support ages 0 to 60 months.");
  }
  if (actual === "cdc" && ageMonths > 240) {
    throw new Error("CDC references in this app support ages 0 to 240 months.");
  }
  const rows = getReference(actual, sex, measurementType, ageMonths);
  const chartKind = actual === "who" ? whoChartKind(measurementType, ageMonths) : cdcChartKind(measurementType, ageMonths);
  return { rows, actual, chartKind };
}

export function measure(input: MeasurementInput): MeasurementResult {
  const ageMonths = ageInMonths(input.birthDate, input.measurementDate);
  const { rows, actual, chartKind } = referenceTable(input.sex, input.measurementType, ageMonths, input.standard);
  const { L, M, S } = interpolateLms(rows, ageMonths);
  const z = zscoreFromMeasurement(input.value, L, M, S);
  const percentile = percentileFromZscore(z);
  const measurementLabel =
    input.measurementType === "height" && ageMonths < 24 ? "length" : input.measurementType;
  const unit = input.measurementType === "weight" ? "kg" : "cm";
  return {
    sex: input.sex,
    birthDate: isoDate(input.birthDate),
    measurementDate: isoDate(input.measurementDate),
    ageMonths: round(ageMonths, 3),
    measurementType: input.measurementType,
    measurementLabel,
    value: input.value,
    unit,
    zscore: round(z, 4),
    percentile: round(percentile, 2),
    standardRequested: input.standard,
    standardUsed: actual,
    chartKind,
    L,
    M,
    S,
    table: rows,
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
