import { rules } from '../config';
import { brier, calibration, checkCall, gapOf, hitRate, isAgainstModel, modelCall, revisionReason, verdict } from './rules';

const long = 'Power cut on the feeder since 03:00; no heating before noon.';

describe('rule 2: calls against the model', () => {
  it('measures the gap from the call’s weight', () => {
    expect(gapOf('closed', 0.2)).toBeCloseTo(0.8);
    expect(gapOf('remote', 0.9)).toBeCloseTo(0.1);
    expect(gapOf('open', 0.3)).toBeCloseTo(0.3);
    expect(gapOf('delayed', 0.9)).toBeCloseTo(0.4);
  });

  it('only a gap strictly above 0.35 counts as against', () => {
    expect(rules.overrideGap).toBe(0.35);
    expect(isAgainstModel('open', 0.35)).toBe(false);
    expect(isAgainstModel('open', 0.36)).toBe(true);
    expect(isAgainstModel('closed', 0.65)).toBe(false);
    expect(isAgainstModel('closed', 0.64)).toBe(true);
    expect(isAgainstModel('closed', null)).toBe(false);
  });

  it('a call against the model needs a reason of 30+ characters', () => {
    const short = checkCall({ call: 'closed', reason: 'Power cut', probability: 0.1, current: null, locked: false });
    expect(short.against).toBe(true);
    expect(short.reasonMin).toBe(30);
    expect(short.error).toMatch(/against the model by 90 points.*at least 30 characters/);
    expect(checkCall({ call: 'closed', reason: long, probability: 0.1, current: null, locked: false }).error).toBeNull();
    // With the model, a short reason is fine.
    expect(checkCall({ call: 'closed', reason: 'Roads shut', probability: 0.9, current: null, locked: false }).error).toBeNull();
    // Without a forecast there is no model to go against.
    expect(checkCall({ call: 'closed', reason: 'Roads shut', probability: null, current: null, locked: false }).against).toBe(false);
  });

  it('every call needs a reason, and repeating the call in force is refused', () => {
    expect(checkCall({ call: 'open', reason: '  ', probability: 0.1, current: null, locked: false }).error).toMatch(/reason/);
    expect(checkCall({ call: 'open', reason: 'ok', probability: 0.1, current: null, locked: false }).error).toMatch(/at least 3/);
    expect(checkCall({ call: 'open', reason: 'Clear roads', probability: 0.1, current: 'open', locked: false }).error).toMatch(/already the call/);
    expect(checkCall({ call: 'open', reason: 'x'.repeat(401), probability: 0.1, current: null, locked: false }).error).toMatch(/400 characters or fewer/);
  });
});

describe('rule 3: the 09:00 lock', () => {
  it('a change after the lock is a revision with "Revised" in the reason', () => {
    const c = checkCall({ call: 'closed', reason: 'Bus operator pulled the ridge route at 09:30.', probability: 0.8, current: 'delayed', locked: true });
    expect(c.error).toBeNull();
    expect(c.revision).toBe(true);
    expect(c.reason).toBe('Revised: Bus operator pulled the ridge route at 09:30.');
    expect(c.reasonMax).toBe(400 - 'Revised: '.length);
  });

  it('a revision needs the longer reason too, and keeps an existing "revised"', () => {
    expect(checkCall({ call: 'closed', reason: 'Buses off', probability: 0.8, current: 'open', locked: true }).error).toMatch(/locked at 09:00, so this is a revision. Give a reason of at least 30/);
    expect(revisionReason('Revised after the plough report from the ridge road.')).toBe('Revised after the plough report from the ridge road.');
  });

  it('before the lock a change simply replaces the call; a first call after the lock is not a revision', () => {
    expect(checkCall({ call: 'closed', reason: 'Snow heavier', probability: 0.8, current: 'open', locked: false }).revision).toBe(false);
    const late = checkCall({ call: 'open', reason: 'Clear roads', probability: 0.1, current: null, locked: true });
    expect(late.revision).toBe(false);
    expect(late.reason).toBe('Clear roads');
  });
});

describe('rule 4: hit rate', () => {
  it('closed with under 2 cm and few incidents is over-cautious', () => {
    expect(verdict('closed', { actualSnowCm: 1.5, incidents: 1 })).toBe('over-cautious');
    expect(verdict('remote', { actualSnowCm: 0, incidents: 0 })).toBe('over-cautious');
    expect(verdict('closed', { actualSnowCm: 2, incidents: 0 })).toBe('hit');
    expect(verdict('closed', { actualSnowCm: 1, incidents: 2 })).toBe('hit');
  });

  it('open on a heavy day, or open or delayed with 3+ incidents, is caught out', () => {
    expect(verdict('open', { actualSnowCm: 10, incidents: 0 })).toBe('caught-out');
    expect(verdict('open', { actualSnowCm: 9.5, incidents: 2 })).toBe('hit');
    expect(verdict('open', { actualSnowCm: 0, incidents: 3 })).toBe('caught-out');
    expect(verdict('delayed', { actualSnowCm: 14, incidents: 1 })).toBe('hit');
    expect(verdict('delayed', { actualSnowCm: 4, incidents: 4 })).toBe('caught-out');
  });

  it('counts the hit rate', () => {
    expect(hitRate([])).toEqual({ judged: 0, hits: 0, overCautious: 0, caughtOut: 0, rate: null });
    const h = hitRate(['hit', 'hit', 'over-cautious', 'caught-out']);
    expect(h.rate).toBe(0.5);
    expect(h.overCautious).toBe(1);
    expect(h.caughtOut).toBe(1);
  });

  it('the model’s own call closes at 50%', () => {
    expect(modelCall(0.5)).toBe('closed');
    expect(modelCall(0.49)).toBe('open');
  });

  it('calibration bins and Brier score', () => {
    const pts = [
      { p: 0.05, y: 0 as const },
      { p: 0.1, y: 0 as const },
      { p: 0.9, y: 1 as const },
      { p: 1, y: 1 as const },
      { p: 0.5, y: 0 as const },
    ];
    const bins = calibration(pts);
    expect(bins).toHaveLength(5);
    expect(bins[0]).toMatchObject({ n: 2, observed: 0 });
    expect(bins[0].predicted).toBeCloseTo(0.075);
    expect(bins[2]).toMatchObject({ n: 1, observed: 0 });
    expect(bins[4]).toMatchObject({ n: 2, observed: 1 });
    expect(bins[1]).toMatchObject({ n: 0, predicted: null, observed: null });
    expect(brier(pts)).toBeCloseTo((0.0025 + 0.01 + 0.01 + 0 + 0.25) / 5);
    expect(brier([])).toBeNull();
  });
});
