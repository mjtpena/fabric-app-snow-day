import { PermissionError, RuleError } from '@x10/shared/data';
import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from '../app.config';
import { defs } from '../model';
import { seed } from '../seed';
import { importForecasts, loadDesk, logForecast, makeCall, parseForecastCsv, recordOutcome, saveSite, validateForecast } from './actions';
import { addDaysKey } from './time';

async function setup() {
  const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
  const people = await store.repo('Person').list();
  const as = (sub: string) => people.find((p) => p.sub === sub)!;
  const desk = await loadDesk(store, FIXED_NOW);
  const site = (name: string) => desk.sites.find((s) => s.name === name)!;
  return { store, desk, site, robin: as('demo-duty-robin'), kai: as('demo-lead-kai'), amara: as('demo-lead-amara') };
}

const later = (min: number) => new Date(FIXED_NOW.getTime() + min * 60_000);

describe('the call', () => {
  it('only the duty manager makes the call', async () => {
    const { store, desk, site, kai } = await setup();
    await expect(makeCall(store, kai, { siteId: site('Upper Fells School').id, day: desk.deskDay, call: 'closed', reason: 'Snow on the fells road' }, later(1))).rejects.toBeInstanceOf(PermissionError);
  });

  it('AC2: calling against the model by more than the gap requires a reason of 30+ characters', async () => {
    const { store, desk, site, robin } = await setup();
    const clinic = site('Ridge Road Clinic');
    const p = desk.cell(clinic.id, desk.deskDay).probability!;
    expect(p).toBeGreaterThan(0.85);
    const err = await makeCall(store, robin, { siteId: clinic.id, day: desk.deskDay, call: 'open', reason: 'Gritted' }, later(1)).catch((e) => e);
    expect(err).toBeInstanceOf(RuleError);
    expect(err.message).toMatch(/against the model.*at least 30 characters/);
    const ok = await makeCall(
      store,
      robin,
      { siteId: clinic.id, day: desk.deskDay, call: 'open', reason: 'Clinic road is on the hospital gritting route and was cleared at 04:00.' },
      later(2),
    );
    expect(ok.against).toBe(true);
    expect(ok.decision.modelProbability).toBeCloseTo(p, 2);
    const after = await loadDesk(store, later(3));
    expect(after.cell(clinic.id, desk.deskDay).decision?.call).toBe('open');
    expect(after.cell(clinic.id, desk.deskDay).against).toBe(true);
  });

  it('a call with the model needs only a short reason', async () => {
    const { store, desk, site, robin } = await setup();
    const r = await makeCall(store, robin, { siteId: site('Upper Fells School').id, day: desk.deskDay, call: 'closed', reason: 'Fells road drifting' }, later(1));
    expect(r.against).toBe(false);
    expect(r.revision).toBe(false);
  });

  it('AC3: after 09:00 a change creates a revised decision instead of editing', async () => {
    const { store, desk, site, robin } = await setup();
    const locked = addDaysKey(desk.deskDay, -1); // always past its 09:00 lock
    const harbour = site('Harbour Lane School');
    const before = desk.cell(harbour.id, locked);
    expect(before.locked).toBe(true);
    expect(before.decision?.call).toBe('open');
    const short = await makeCall(store, robin, { siteId: harbour.id, day: locked, call: 'closed', reason: 'Ice on the paths' }, later(1)).catch((e) => e);
    expect(short.message).toMatch(/locked at 09:00/);
    const r = await makeCall(store, robin, { siteId: harbour.id, day: locked, call: 'closed', reason: 'Burst pipe in the main hall at 10:15; pupils sent home.' }, later(2));
    expect(r.revision).toBe(true);
    expect(r.decision.reason).toBe('Revised: Burst pipe in the main hall at 10:15; pupils sent home.');
    const after = (await loadDesk(store, later(3))).cell(harbour.id, locked);
    expect(after.history).toHaveLength(2);
    expect(after.history[1].id).toBe(before.decision!.id);
    expect(after.history[1].call).toBe('open');
    expect(after.decision?.call).toBe('closed');
  });

  it('before the lock a change supersedes the call and both stay on record', async () => {
    const { store, desk, site, robin } = await setup();
    const ford = site('Old Ford Library');
    expect(desk.cell(ford.id, desk.deskDay).locked).toBe(false);
    await makeCall(store, robin, { siteId: ford.id, day: desk.deskDay, call: 'open', reason: 'Roads wet' }, later(1));
    const r = await makeCall(store, robin, { siteId: ford.id, day: desk.deskDay, call: 'delayed', reason: 'Car park icy' }, later(2));
    expect(r.revision).toBe(false);
    expect(r.decision.reason).toBe('Car park icy');
    const cell = (await loadDesk(store, later(3))).cell(ford.id, desk.deskDay);
    expect(cell.history.map((d) => d.call)).toEqual(['delayed', 'open']);
  });

  it('refuses days beyond the dial', async () => {
    const { store, desk, site, robin } = await setup();
    await expect(makeCall(store, robin, { siteId: site('Valley Depot').id, day: addDaysKey(desk.deskDay, 5), call: 'open', reason: 'Too early' }, later(1))).rejects.toThrow(/next five days/);
  });
});

describe('weather station', () => {
  const base = { snowCm: 4, tempMinC: -2, windKmh: 20, iceRisk: 'medium' as const, source: 'Met service' };

  it('a lead logs forecasts for their own sites only; the duty manager for any', async () => {
    const { store, desk, site, kai, robin } = await setup();
    await expect(logForecast(store, kai, { ...base, siteId: site('Valley Depot').id, day: desk.deskDay }, later(1))).rejects.toBeInstanceOf(PermissionError);
    const f = await logForecast(store, kai, { ...base, siteId: site('Pine Hollow Depot').id, day: desk.deskDay }, later(1));
    expect(f.enteredBy).toBe('demo-lead-kai');
    await logForecast(store, robin, { ...base, siteId: site('Valley Depot').id, day: desk.deskDay, snowCm: 9 }, later(2));
    const after = await loadDesk(store, later(3));
    expect(after.cell(site('Pine Hollow Depot').id, desk.deskDay).probability).not.toBeNull();
    expect(after.cell(site('Valley Depot').id, desk.deskDay).forecast?.snowCm).toBe(9);
    expect(after.cell(site('Valley Depot').id, desk.deskDay).forecasts).toHaveLength(2);
  });

  it('validates the numbers and the day', () => {
    const today = '2026-11-21';
    expect(validateForecast({ ...base, siteId: 's', day: today }, today)).toEqual({});
    const e = validateForecast({ siteId: '', day: '2026-12-31', snowCm: -1, tempMinC: Number.NaN, windKmh: 400, iceRisk: 'extreme' as never, source: 'x' }, today);
    expect(Object.keys(e).sort()).toEqual(['day', 'iceRisk', 'siteId', 'snowCm', 'source', 'tempMinC', 'windKmh']);
  });

  it('parses a CSV with a preview of every row', async () => {
    const { desk } = await setup();
    const csv = [
      'Site,Day,Snow cm,Temp min C,Wind km/h,Ice risk,Source',
      `Summit Primary,${desk.deskDay},14,-7,40,high,Met service`,
      `summit primary,${desk.days[1]},"30,5",-9,60,medium,Met service`,
      `Nowhere School,${desk.deskDay},1,0,5,low,Met service`,
      `Valley Depot,${desk.deskDay},lots,0,5,low,Met service`,
      `Valley Depot,21/11/2026,1,0,5,low,Met service`,
    ].join('\n');
    const kaiOnly = (s: { leadSub: string | null }) => s.leadSub === 'demo-lead-kai';
    const { rows, headerError } = parseForecastCsv(csv, desk.sites, desk.today, kaiOnly);
    expect(headerError).toBeNull();
    expect(rows.map((r) => [r.line, !!r.input])).toEqual([[2, true], [3, true], [4, false], [5, false], [6, false]]);
    expect(rows[1].input?.snowCm).toBe(30.5);
    expect(rows[2].error).toMatch(/No site called/);
    expect(rows[3].error).toMatch(/own sites/);
    expect(parseForecastCsv('site,day\nA,2026-01-01', desk.sites, desk.today).headerError).toMatch(/Missing columns: snow_cm/);
    expect(parseForecastCsv('', desk.sites, desk.today).headerError).toMatch(/empty/);
  });

  it('imports the good rows of a CSV', async () => {
    const { store, desk, kai } = await setup();
    const csv = `site,day,snow_cm,temp_min_c,wind_kmh,ice_risk,source\nPine Hollow Depot,${desk.deskDay},10,-6,35,medium,Road weather station\nPine Hollow Depot,${desk.days[1]},28,-9,50,medium,Road weather station\nValley Depot,${desk.deskDay},1,0,5,low,Met`;
    const r = await importForecasts(store, kai, csv, later(1));
    expect(r.imported).toBe(2);
    expect(r.skipped).toHaveLength(1);
    await expect(importForecasts(store, kai, 'site,day,snow_cm,temp_min_c,wind_kmh,ice_risk,source\nValley Depot,2026-11-21,1,0,5,low,Met', later(2))).rejects.toThrow(/No row/);
  });
});

describe('outcomes and sites', () => {
  it('records outcomes for past days only, by the lead or the duty manager', async () => {
    const { store, desk, site, kai, amara } = await setup();
    const summit = site('Summit Primary');
    const yesterday = addDaysKey(desk.today, -1);
    await expect(recordOutcome(store, amara, { siteId: summit.id, day: yesterday, actualSnowCm: 5, incidents: 1, note: '' }, later(1))).rejects.toBeInstanceOf(PermissionError);
    await expect(recordOutcome(store, kai, { siteId: summit.id, day: addDaysKey(desk.today, 1), actualSnowCm: 5, incidents: 1, note: '' }, later(1))).rejects.toThrow(/once the day has come/);
    await expect(recordOutcome(store, kai, { siteId: summit.id, day: yesterday, actualSnowCm: 5, incidents: 1.5, note: '' }, later(1))).rejects.toThrow(/whole number/);
    const o = await recordOutcome(store, kai, { siteId: summit.id, day: yesterday, actualSnowCm: 5, incidents: 1, note: ' Drifts by the gate ' }, later(1));
    expect(o.note).toBe('Drifts by the gate');
  });

  it('only the duty manager adds or edits sites, with unique names and a known time zone', async () => {
    const { store, kai, robin } = await setup();
    const input = { name: 'Moorside Hall', region: 'Ridge', elevation: 700, exposure: 'exposed' as const, roadClass: 'rural' as const, leadSub: 'demo-lead-kai', timeZone: '' };
    await expect(saveSite(store, kai, input)).rejects.toBeInstanceOf(PermissionError);
    await expect(saveSite(store, robin, { ...input, name: 'summit primary' })).rejects.toThrow(/already has this name/);
    await expect(saveSite(store, robin, { ...input, timeZone: 'Mars/Olympus' })).rejects.toThrow(/time zone/);
    const s = await saveSite(store, robin, input);
    expect(s.leadName).toBe('Kai Lindqvist');
    expect(s.timeZone).toBeNull();
    const moved = await saveSite(store, robin, { ...input, elevation: 720, timeZone: 'Europe/Oslo' }, s.id);
    expect(moved.elevation).toBe(720);
    expect(moved.timeZone).toBe('Europe/Oslo');
  });
});
