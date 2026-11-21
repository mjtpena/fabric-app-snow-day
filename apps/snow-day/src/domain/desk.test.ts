import { runSeed } from '@x10/shared/runtime';
import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from '../app.config';
import { rules } from '../config';
import { defs } from '../model';
import { seed } from '../seed';
import { loadDesk } from './actions';
import { dayCells, meanSnow, trainingRows } from './desk';
import { todayEntries } from './today';
import { addDaysKey, localTimeZone } from './time';

async function seeded() {
  const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
  const desk = await loadDesk(store, FIXED_NOW);
  return { store, desk };
}

describe('seed', () => {
  it('has ten sites in three regions, two winters of history and five forecast days', async () => {
    const { store, desk } = await seeded();
    expect(desk.sites).toHaveLength(10);
    expect(desk.regions).toEqual(['Ridge', 'Valley', 'Lakeshore']);
    expect(desk.days).toHaveLength(5);
    const winters = new Set(desk.past.filter((c) => c.day < addDaysKey(desk.deskDay, -100)).map((c) => c.day.slice(0, 4)));
    expect(winters.size).toBeGreaterThanOrEqual(2);
    expect(desk.past.filter((c) => c.outcome).length).toBeGreaterThan(150);
    // Every site has a forecast for every dial day except the two gaps.
    const missing = desk.sites.flatMap((s) => desk.days.filter((d) => !desk.cell(s.id, d).forecast).map((d) => `${s.name} ${desk.days.indexOf(d)}`));
    expect(missing).toEqual(['Pine Hollow Depot 0', 'Pine Hollow Depot 1', 'North Shore Pool 3', 'North Shore Pool 4']);
    // Today's calls are partly made, one of them against the model.
    const today = dayCells(desk, desk.deskDay);
    expect(today.filter((c) => c.decision).map((c) => c.site.name).sort()).toEqual(['Harbour Lane School', 'Millbrook Academy', 'Summit Primary', 'Valley Depot']);
    expect(today.filter((c) => c.against).map((c) => c.site.name)).toEqual(['Harbour Lane School']);
    // Two past revisions after the lock, kept beside the calls they replaced.
    expect(desk.past.filter((c) => c.history.length > 1 && /^Revised/.test(c.decision!.reason)).length).toBeGreaterThanOrEqual(3);
    // Idempotent.
    expect(await runSeed(store, personas, seed, FIXED_NOW)).toBe(false);
    expect(await store.repo('Site').list()).toHaveLength(10);
  });

  it('AC1: the model fitted on the seed gives the storm day a higher probability than a clear day', async () => {
    const { desk } = await seeded();
    expect(desk.model.source).toBe('fitted');
    expect(desk.model.n).toBeGreaterThanOrEqual(rules.minHistory);
    const storm = desk.days[1];
    const clear = desk.days[4];
    for (const s of desk.sites) {
      const a = desk.cell(s.id, storm).probability;
      const b = desk.cell(s.id, clear).probability;
      if (a !== null && b !== null) expect(a, s.name).toBeGreaterThan(b);
    }
    const mean = (day: string) => {
      const ps = dayCells(desk, day).flatMap((c) => (c.probability === null ? [] : [c.probability]));
      return ps.reduce((x, y) => x + y, 0) / ps.length;
    };
    expect(mean(storm)).toBeGreaterThan(0.8);
    expect(mean(clear)).toBeLessThan(0.1);
    expect(meanSnow(dayCells(desk, storm))).toBeGreaterThan(meanSnow(dayCells(desk, clear)) + 10);
    // Sensible signs: more snow, cold, ice and minor roads all push toward closing.
    for (const k of ['snow', 'cold', 'ice', 'road'] as const) expect(desk.model.coef[k], k).toBeGreaterThan(0);
  });

  it('trains only on past days', async () => {
    const { store, desk } = await seeded();
    const raw = {
      sites: await store.repo('Site').list(),
      forecasts: await store.repo('Forecast').list(),
      decisions: await store.repo('Decision').list(),
      outcomes: [],
      people: [],
    };
    // Today's four calls are not training data.
    expect(trainingRows(raw, FIXED_NOW, localTimeZone())).toHaveLength(desk.model.n);
    expect(desk.model.n).toBe(desk.past.filter((c) => c.forecast).length);
  });
});

describe('Today', () => {
  it('duty manager: uncalled likely closures, calls against the model, missing forecasts, the lock, the storm', async () => {
    const { desk } = await seeded();
    const items = todayEntries(desk, 'duty', 'demo-duty-robin');
    expect(items.map((i) => i.id)).toEqual(['uncalled', 'against', 'missing', 'lock', 'peak']);
    const uncalled = items[0];
    expect(uncalled.lens).toBe('probability');
    expect(uncalled.meta).toMatch(/Ridge Road Clinic/);
    expect(items[1].siteId).toBe(desk.sites.find((s) => s.name === 'Harbour Lane School')!.id);
    expect(items[2].title).toMatch(/2 sites are missing a forecast/);
    expect(items[2].severity).toBe('bad');
    expect(items[3].meta).toBe('4 of 10 called');
    expect(items[4].day).toBe(desk.days[1]);
    expect(items[4].title).toMatch(/Heaviest snow: 34 cm at Summit Primary/);
  });

  it('site lead: only their own sites, plus outcomes to record', async () => {
    const { desk } = await seeded();
    const items = todayEntries(desk, 'lead', 'demo-lead-kai');
    expect(items.find((i) => i.id === 'missing')?.title).toMatch(/Pine Hollow Depot has no forecast for 2 days/);
    expect(items.find((i) => i.id === 'against')).toBeUndefined();
    const amara = todayEntries(desk, 'lead', 'demo-lead-amara');
    expect(amara.find((i) => i.id === 'missing')).toBeUndefined();
    expect(amara.find((i) => i.id === 'lock')?.meta).toBe('2 of 3 called');
    expect(items.length).toBeLessThanOrEqual(5);
  });
});
