import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from '../app.config';
import { defs } from '../model';
import { seed } from '../seed';
import { loadDesk } from './actions';
import { hindsight } from './hindsight';

describe('hindsight on the seed', () => {
  it('judges past calls against outcomes and compares the model', async () => {
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    const h = hindsight(await loadDesk(store, FIXED_NOW));
    expect(h.people.judged).toBeGreaterThan(150);
    expect(h.people.hits + h.people.overCautious + h.people.caughtOut).toBe(h.people.judged);
    // The forecast bust left valley and lake closures over-cautious; the ridge surprise caught someone out.
    expect(h.people.overCautious).toBeGreaterThanOrEqual(5);
    expect(h.people.caughtOut).toBeGreaterThanOrEqual(1);
    expect(h.model.judged).toBe(h.people.judged);
    expect(h.calibration.reduce((s, b) => s + b.n, 0)).toBe(h.points);
    // Calibrated: the top band is mostly closed, the bottom band mostly open.
    expect(h.calibration[4].observed!).toBeGreaterThan(0.8);
    expect(h.calibration[0].observed!).toBeLessThan(0.2);
    expect(h.byRegion.map((r) => r.region)).toEqual(['Ridge', 'Valley', 'Lakeshore']);
  });
});
