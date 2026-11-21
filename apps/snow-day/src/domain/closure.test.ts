import { PRIOR, rules } from '../config';
import { drivers, featureVector, fitModel, logOdds, predict, priorModel, sigmoid, solve, type ModelInput, type TrainingRow } from './closure';

const clear: ModelInput = { snowCm: 0, tempMinC: -1, windKmh: 10, iceRisk: 'low', elevation: 200, exposure: 'sheltered', roadClass: 'main' };
const storm: ModelInput = { snowCm: 30, tempMinC: -9, windKmh: 60, iceRisk: 'high', elevation: 900, exposure: 'exposed', roadClass: 'rural' };

/** A synthetic desk that closes on its own hidden rule. */
function history(n: number, rule: (x: ModelInput) => number, seed = 1): TrainingRow[] {
  let a = seed;
  const rnd = () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
  const ices = ['low', 'medium', 'high'] as const;
  const expos = ['sheltered', 'normal', 'exposed'] as const;
  const roads = ['main', 'secondary', 'rural'] as const;
  return Array.from({ length: n }, () => {
    const x: ModelInput = {
      snowCm: Math.round(rnd() * 35),
      tempMinC: Math.round(-12 + rnd() * 14),
      windKmh: Math.round(rnd() * 60),
      iceRisk: ices[Math.floor(rnd() * 3)],
      elevation: Math.round(rnd() * 1000),
      exposure: expos[Math.floor(rnd() * 3)],
      roadClass: roads[Math.floor(rnd() * 3)],
    };
    const y: 0 | 1 = rnd() < sigmoid(rule(x)) ? 1 : 0;
    return { x, y };
  });
}

describe('closure model', () => {
  it('maps inputs to natural units', () => {
    expect(featureVector(storm)).toEqual({ snow: 30, cold: 9, wind: 60, ice: 2, elevation: 9, exposure: 2, road: 2 });
  });

  it('the prior gives a storm a higher probability than a clear day', () => {
    const m = priorModel();
    expect(m.source).toBe('prior');
    expect(predict(m, storm)).toBeGreaterThan(0.95);
    expect(predict(m, clear)).toBeLessThan(0.1);
  });

  it('drivers add up to the log-odds', () => {
    const m = priorModel();
    const sum = drivers(m, storm).reduce((s, d) => s + d.push, m.intercept);
    expect(sum).toBeCloseTo(logOdds(m, storm), 10);
    expect(drivers(m, storm)[0].feature).toBe('snow');
  });

  it('uses the hand-set prior when the history is short (< 15 decisions)', () => {
    const rows = history(rules.minHistory - 1, (x) => x.snowCm - 10);
    const m = fitModel(rows);
    expect(m.source).toBe('prior');
    expect(m.n).toBe(14);
    expect(m.coef).toEqual(PRIOR.coef);
    expect(fitModel(history(rules.minHistory, (x) => x.snowCm - 10)).source).toBe('fitted');
  });

  it('learns the desk’s own habits from enough history', () => {
    // This desk closes for ice far more readily than the prior assumes, and ignores wind.
    const rule = (x: ModelInput) => -3 + 0.2 * x.snowCm + 2.5 * ['low', 'medium', 'high'].indexOf(x.iceRisk);
    const m = fitModel(history(600, rule, 7));
    expect(m.source).toBe('fitted');
    expect(m.coef.ice).toBeGreaterThan(PRIOR.coef.ice + 0.8);
    expect(Math.abs(m.coef.wind)).toBeLessThan(PRIOR.coef.wind);
    expect(m.coef.snow).toBeGreaterThan(0.1);
    expect(m.accuracy!).toBeGreaterThan(0.75);
  });

  it('stays finite on perfectly separable history and on one-sided history', () => {
    const separable = history(40, (x) => (x.snowCm > 15 ? 50 : -50));
    const m = fitModel(separable);
    expect(Number.isFinite(m.intercept)).toBe(true);
    expect(Object.values(m.coef).every(Number.isFinite)).toBe(true);
    const allOpen = history(30, () => -50);
    const m2 = fitModel(allOpen);
    expect(m2.positives).toBe(0);
    expect(predict(m2, clear)).toBeLessThan(0.05);
  });

  it('keeps the prior coefficient for an input that never varied', () => {
    const rows = history(60, (x) => x.snowCm - 12).map((r) => ({ ...r, x: { ...r.x, roadClass: 'main' as const } }));
    const m = fitModel(rows);
    expect(m.constant).toEqual(['road']);
    expect(m.coef.road).toBe(PRIOR.coef.road);
  });

  it('solves small linear systems', () => {
    expect(solve([[2, 1], [1, 3]], [3, 5]).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0.8, 1.4]);
    expect(() => solve([[1, 2], [2, 4]], [1, 2])).toThrow();
  });
});
