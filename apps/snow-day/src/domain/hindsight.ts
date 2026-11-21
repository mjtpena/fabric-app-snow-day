/**
 * Hindsight (rule 4): past calls against what the day brought, the same days had the model made the call, and how
 * well the model's probabilities match the calls actually made (calibration). Pure.
 */
import type { Desk, SiteDay } from './desk';
import { brier, calibration, hitRate, modelCall, verdict, type CalibrationBin, type HitRate, type Verdict } from './rules';

export interface Hindsight {
  /** Past site-days with a call and an outcome, newest first. */
  judged: SiteDay[];
  people: HitRate;
  /** The same days judged as if the model had called them (closed at 50% or more, else open). */
  model: HitRate;
  /** Days where the model would have been right and the call was not, and the reverse. */
  modelBetter: SiteDay[];
  peopleBetter: SiteDay[];
  calibration: CalibrationBin[];
  brier: number | null;
  /** Past calls with a forecast (the calibration points). */
  points: number;
  byRegion: { region: string; rate: HitRate }[];
}

export function hindsight(desk: Desk): Hindsight {
  const judged = desk.past.filter((c) => c.decision && c.outcome && c.verdict);
  const modelVerdict = (c: SiteDay): Verdict | null => (c.probability === null ? null : verdict(modelCall(c.probability), c.outcome!));
  const withModel = judged.filter((c) => c.probability !== null);
  const modelVerdicts = withModel.map((c) => modelVerdict(c)!);
  const pts = desk.past
    .filter((c) => c.decision && c.probability !== null)
    .map((c) => ({ p: c.probability!, y: (c.decision!.call === 'closed' || c.decision!.call === 'remote' ? 1 : 0) as 0 | 1 }));
  return {
    judged,
    people: hitRate(judged.map((c) => c.verdict!)),
    model: hitRate(modelVerdicts),
    modelBetter: withModel.filter((c) => c.verdict !== 'hit' && modelVerdict(c) === 'hit'),
    peopleBetter: withModel.filter((c) => c.verdict === 'hit' && modelVerdict(c) !== 'hit'),
    calibration: calibration(pts),
    brier: brier(pts),
    points: pts.length,
    byRegion: desk.regions.map((region) => ({ region, rate: hitRate(judged.filter((c) => c.site.region === region).map((c) => c.verdict!)) })),
  };
}
