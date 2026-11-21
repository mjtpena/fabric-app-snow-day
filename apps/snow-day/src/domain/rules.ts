/**
 * The decision rules (spec rules 2–4), pure:
 * - a call against the model by more than `rules.overrideGap` needs a reason of `rules.overrideReasonMin`+ characters;
 * - after the 09:00 lock a change is a new decision whose reason says "Revised" (and needs the longer reason too);
 * - the hit rate judges each past call against what the day brought.
 */
import { CALL_WEIGHT, rules } from '../config';
import { limits, type Call } from '../model';

/** Distance between a call and the model's closure probability (open 0, delayed 0.5, closed/remote 1). */
export function gapOf(call: Call, probability: number): number {
  return Math.abs(CALL_WEIGHT[call] - probability);
}

/** Strictly more than the gap counts as against the model. */
export function isAgainstModel(call: Call, probability: number | null | undefined): boolean {
  if (probability === null || probability === undefined) return false;
  return gapOf(call, probability) > rules.overrideGap + 1e-12;
}

export const REVISED_PREFIX = 'Revised: ';

export function isRevisionReason(reason: string): boolean {
  return /\brevised\b/i.test(reason);
}

/** The stored reason of a revision: says "Revised" exactly once. */
export function revisionReason(reason: string): string {
  const r = reason.trim();
  return isRevisionReason(r) ? r : `${REVISED_PREFIX}${r}`;
}

export interface CallCheckInput {
  call: Call;
  reason: string;
  /** The model's probability for this site and day (null without a forecast). */
  probability: number | null;
  /** The call already in force for this site and day, if any. */
  current: Call | null;
  /** Calls for the day have locked (09:00 site time has passed). */
  locked: boolean;
}

export interface CallCheck {
  /** Null when the call can be recorded. */
  error: string | null;
  against: boolean;
  gap: number | null;
  /** A change after the lock: recorded as a revision. */
  revision: boolean;
  /** Characters the reason needs. */
  reasonMin: number;
  reasonMax: number;
  /** The reason as it will be stored. */
  reason: string;
}

/** Everything The call form needs to know before it records a decision. */
export function checkCall(input: CallCheckInput): CallCheck {
  const against = isAgainstModel(input.call, input.probability);
  const gap = input.probability === null ? null : gapOf(input.call, input.probability);
  const revision = input.locked && input.current !== null;
  const reasonMin = against || revision ? rules.overrideReasonMin : limits.reason.min;
  const reasonMax = revision && !isRevisionReason(input.reason) ? limits.reason.max - REVISED_PREFIX.length : limits.reason.max;
  const text = input.reason.trim();
  let error: string | null = null;
  if (input.current === input.call) error = `${input.call[0].toUpperCase()}${input.call.slice(1)} is already the call for this day.`;
  else if (!text) error = 'Give a reason for the call.';
  else if (text.length < reasonMin) {
    const why = [
      against ? `This goes against the model by ${Math.round((gap ?? 0) * 100)} points.` : '',
      revision ? `Calls for this day locked at ${String(rules.lockHour).padStart(2, '0')}:00, so this is a revision.` : '',
    ].filter(Boolean);
    error = why.length ? `${why.join(' ')} Give a reason of at least ${reasonMin} characters (now ${text.length}).` : `The reason needs at least ${reasonMin} characters.`;
  }
  else if (text.length > reasonMax) error = `The reason must be ${reasonMax} characters or fewer (now ${text.length}).`;
  return { error, against, gap, revision, reasonMin, reasonMax, reason: revision ? revisionReason(text) : text };
}

/* ------------------------------------------------------------------ hindsight */

export type Verdict = 'hit' | 'over-cautious' | 'caught-out';

export const VERDICT_LABEL: Record<Verdict, string> = { hit: 'Right call', 'over-cautious': 'Over-cautious', 'caught-out': 'Caught out' };

/**
 * Judge a call against the day (rule 4).
 * - Over-cautious: closed or remote, under 2 cm of snow and at most 1 incident.
 * - Caught out: open with 10 cm or more, or open or delayed with 3 or more incidents.
 * - Anything else is a right call.
 */
export function verdict(call: Call, outcome: { actualSnowCm: number; incidents: number }): Verdict {
  const quiet = outcome.actualSnowCm < rules.overCautiousSnowCm && outcome.incidents <= rules.lowIncidents;
  if (call === 'closed' || call === 'remote') return quiet ? 'over-cautious' : 'hit';
  if (outcome.incidents >= rules.caughtOutIncidents) return 'caught-out';
  if (call === 'open' && outcome.actualSnowCm >= rules.caughtOutSnowCm) return 'caught-out';
  return 'hit';
}

export interface HitRate {
  judged: number;
  hits: number;
  overCautious: number;
  caughtOut: number;
  /** hits / judged; null when nothing has an outcome yet. */
  rate: number | null;
}

export function hitRate(verdicts: Verdict[]): HitRate {
  const hits = verdicts.filter((v) => v === 'hit').length;
  const overCautious = verdicts.filter((v) => v === 'over-cautious').length;
  const caughtOut = verdicts.filter((v) => v === 'caught-out').length;
  return { judged: verdicts.length, hits, overCautious, caughtOut, rate: verdicts.length ? hits / verdicts.length : null };
}

/** What the model would have called: closed at or above `rules.modelCloseAt`, else open. */
export function modelCall(probability: number): Call {
  return probability >= rules.modelCloseAt ? 'closed' : 'open';
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  /** Mean predicted probability in the bin (null when empty). */
  predicted: number | null;
  /** Share of those days that were called closed or remote (null when empty). */
  observed: number | null;
}

/** Reliability table: predicted probability vs. the share of days actually called closed or remote. */
export function calibration(points: { p: number; y: 0 | 1 }[], bins = 5): CalibrationBin[] {
  return Array.from({ length: bins }, (_, i) => {
    const lo = i / bins;
    const hi = (i + 1) / bins;
    const inBin = points.filter((pt) => pt.p >= lo && (i === bins - 1 ? pt.p <= hi : pt.p < hi));
    const n = inBin.length;
    return {
      lo,
      hi,
      n,
      predicted: n ? inBin.reduce((s, pt) => s + pt.p, 0) / n : null,
      observed: n ? inBin.reduce((s, pt) => s + pt.y, 0) / n : null,
    };
  });
}

/** Brier score: mean squared gap between probability and call (lower is better). */
export function brier(points: { p: number; y: 0 | 1 }[]): number | null {
  if (!points.length) return null;
  return points.reduce((s, pt) => s + (pt.p - pt.y) ** 2, 0) / points.length;
}
