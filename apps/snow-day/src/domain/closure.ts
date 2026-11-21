/**
 * The closure model (rule 1): a logistic regression on the forecast and the site, fitted to the desk's own past
 * decisions (closed or remote = 1, open or delayed = 0).
 *
 * - Fewer than `rules.minHistory` past decisions: the hand-set PRIOR is used as is.
 * - Otherwise: maximum likelihood with a ridge penalty that pulls each (standardised) coefficient toward the prior,
 *   solved by Newton's method. The penalty keeps the fit finite when the history is small or perfectly separable,
 *   and lets the data win once there is plenty of it.
 * - Coefficients are reported in natural units (per cm, per °C below zero, per 100 m…) so the About page and the
 *   driver breakdown can explain them. An input that never varies in the history keeps its prior coefficient.
 * Pure and deterministic.
 */
import { EXPOSURE_LEVEL, FEATURES, ICE_LEVEL, PRIOR, ROAD_LEVEL, rules, type Feature } from '../config';
import type { Exposure, IceRisk, RoadClass } from '../model';

export interface ModelInput {
  snowCm: number;
  tempMinC: number;
  windKmh: number;
  iceRisk: IceRisk;
  elevation: number;
  exposure: Exposure;
  roadClass: RoadClass;
}

export interface TrainingRow {
  x: ModelInput;
  /** 1 = closed or remote. */
  y: 0 | 1;
}

export interface ClosureModel {
  source: 'prior' | 'fitted';
  intercept: number;
  coef: Record<Feature, number>;
  /** Past decisions it was fitted on (or that were available when it fell back to the prior). */
  n: number;
  /** Of those, closed or remote. */
  positives: number;
  /** Inputs that never varied in the history and kept their prior coefficient. */
  constant: Feature[];
  /** Mean log loss on the history (null for the prior with no history). */
  logLoss: number | null;
  /** Share of past decisions the model gets right at 50% (null without history). */
  accuracy: number | null;
}

export const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** The model's inputs in natural units: snow cm, degrees below zero, km/h, ordinal steps, hundreds of metres. */
export function featureVector(x: ModelInput): Record<Feature, number> {
  return {
    snow: x.snowCm,
    cold: -x.tempMinC,
    wind: x.windKmh,
    ice: ICE_LEVEL[x.iceRisk],
    elevation: x.elevation / 100,
    exposure: EXPOSURE_LEVEL[x.exposure],
    road: ROAD_LEVEL[x.roadClass],
  };
}

export function logOdds(model: Pick<ClosureModel, 'intercept' | 'coef'>, x: ModelInput): number {
  const f = featureVector(x);
  let z = model.intercept;
  for (const k of FEATURES) z += model.coef[k] * f[k];
  return z;
}

/** Probability of a closure call (closed or remote), 0..1. */
export function predict(model: Pick<ClosureModel, 'intercept' | 'coef'>, x: ModelInput): number {
  return sigmoid(logOdds(model, x));
}

export interface Driver {
  feature: Feature;
  /** The input in model units (cm, °C below zero…). */
  value: number;
  /** Its push on the log-odds (positive = toward closing). */
  push: number;
}

/** Each input's push on the log-odds, biggest first. The intercept plus every push equals logOdds(). */
export function drivers(model: Pick<ClosureModel, 'intercept' | 'coef'>, x: ModelInput): Driver[] {
  const f = featureVector(x);
  return FEATURES.map((k) => ({ feature: k, value: f[k], push: model.coef[k] * f[k] })).sort((a, b) => Math.abs(b.push) - Math.abs(a.push));
}

function scores(model: Pick<ClosureModel, 'intercept' | 'coef'>, rows: TrainingRow[]) {
  if (!rows.length) return { logLoss: null, accuracy: null };
  let loss = 0;
  let right = 0;
  for (const r of rows) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, predict(model, r.x)));
    loss += r.y ? -Math.log(p) : -Math.log(1 - p);
    if ((p >= 0.5 ? 1 : 0) === r.y) right++;
  }
  return { logLoss: loss / rows.length, accuracy: right / rows.length };
}

export function priorModel(rows: TrainingRow[] = []): ClosureModel {
  const positives = rows.filter((r) => r.y === 1).length;
  return { source: 'prior', intercept: PRIOR.intercept, coef: { ...PRIOR.coef }, n: rows.length, positives, constant: [], ...scores(PRIOR, rows) };
}

/** Solve A x = b (small dense system) by Gaussian elimination with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('Singular system');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export interface FitOptions {
  minHistory?: number;
  priorStrength?: number;
  maxIterations?: number;
}

/**
 * Fit the model to past decisions. Returns the prior outright when there are fewer than `minHistory` rows.
 */
export function fitModel(rows: TrainingRow[], opts: FitOptions = {}): ClosureModel {
  const minHistory = opts.minHistory ?? rules.minHistory;
  const lambda = opts.priorStrength ?? rules.priorStrength;
  if (rows.length < minHistory) return priorModel(rows);

  const X = rows.map((r) => featureVector(r.x));
  const mean = {} as Record<Feature, number>;
  const sd = {} as Record<Feature, number>;
  for (const k of FEATURES) {
    const m = X.reduce((s, f) => s + f[k], 0) / X.length;
    const v = X.reduce((s, f) => s + (f[k] - m) ** 2, 0) / X.length;
    mean[k] = m;
    sd[k] = Math.sqrt(v);
  }
  const free = FEATURES.filter((k) => sd[k] > 1e-9);
  const constant = FEATURES.filter((k) => sd[k] <= 1e-9);

  // Standardised design: column 0 is the intercept, then one column per free input. Constant inputs enter as a fixed
  // offset at their prior coefficient.
  const Z = X.map((f) => [1, ...free.map((k) => (f[k] - mean[k]) / sd[k])]);
  const offset = X.map((f) => constant.reduce((s, k) => s + PRIOR.coef[k] * f[k], 0));
  const y = rows.map((r) => r.y);
  const d = free.length + 1;
  // Prior centre in standardised units; the intercept centre is the prior's log-odds at the mean input.
  const centre = [PRIOR.intercept + free.reduce((s, k) => s + PRIOR.coef[k] * mean[k], 0), ...free.map((k) => PRIOR.coef[k] * sd[k])];
  // A weak pull on the intercept keeps it finite when every past call was the same.
  const pull = [0.01, ...free.map(() => lambda)];

  let theta = [...centre];
  const maxIt = opts.maxIterations ?? 60;
  for (let it = 0; it < maxIt; it++) {
    const g = new Array<number>(d).fill(0);
    const H = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    for (let i = 0; i < Z.length; i++) {
      let z = offset[i];
      for (let j = 0; j < d; j++) z += theta[j] * Z[i][j];
      const p = sigmoid(z);
      const w = Math.max(p * (1 - p), 1e-10);
      const e = p - y[i];
      for (let j = 0; j < d; j++) {
        g[j] += e * Z[i][j];
        const wz = w * Z[i][j];
        for (let k = j; k < d; k++) H[j][k] += wz * Z[i][k];
      }
    }
    for (let j = 0; j < d; j++) {
      g[j] += pull[j] * (theta[j] - centre[j]);
      H[j][j] += pull[j];
      for (let k = 0; k < j; k++) H[j][k] = H[k][j];
    }
    const step = solve(H, g);
    let biggest = 0;
    theta = theta.map((t, j) => {
      biggest = Math.max(biggest, Math.abs(step[j]));
      return t - step[j];
    });
    if (biggest < 1e-9) break;
  }

  const coef = { ...PRIOR.coef };
  let intercept = theta[0];
  free.forEach((k, j) => {
    coef[k] = theta[j + 1] / sd[k];
    intercept -= theta[j + 1] * (mean[k] / sd[k]);
  });
  const model = { intercept, coef };
  return {
    source: 'fitted',
    ...model,
    n: rows.length,
    positives: y.filter(Boolean).length,
    constant,
    ...scores(model, rows),
  };
}
