/**
 * The desk: joins sites, forecasts, decisions and outcomes into one view per site and day, fits the closure model to
 * the past, and scores every cell. Pure: `buildDesk(raw, now, tz)` is all the screens need.
 *
 * Append-only record: the newest forecast for a site and day is the forecast; the newest decision is the call in
 * force (older ones stay as history); the newest outcome is the outcome.
 */
import { groupBy } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';

import { REGION_ORDER } from '../config';
import type { Decision, Forecast, Outcome, Site } from '../model';
import { fitModel, predict, type ClosureModel, type ModelInput, type TrainingRow } from './closure';
import { gapOf, isAgainstModel, verdict, type Verdict } from './rules';
import { addDaysKey, dayKey, dayKeyAt, deskDay, dialDays, isLocked, lockAt, localTimeZone, type DayKey } from './time';

export interface Raw {
  sites: Site[];
  forecasts: Forecast[];
  decisions: Decision[];
  outcomes: Outcome[];
  people: Person[];
}

export interface SiteDay {
  site: Site;
  day: DayKey;
  /** The newest forecast (null when none was entered). */
  forecast: Forecast | null;
  /** Every forecast for the day, newest first. */
  forecasts: Forecast[];
  /** The call in force. */
  decision: Decision | null;
  /** Every decision for the day, newest first (the first is the call in force). */
  history: Decision[];
  outcome: Outcome | null;
  /** The current model's closure probability (null without a forecast). */
  probability: number | null;
  /** The call in force goes against the model by more than the gap. */
  against: boolean;
  gap: number | null;
  locked: boolean;
  lockAt: string;
  verdict: Verdict | null;
}

export interface Desk {
  now: Date;
  /** The desk's time zone (sites without their own use it). */
  tz: string;
  /** Calendar today in the desk's zone. */
  today: DayKey;
  /** First day with open calls (today before 09:00, tomorrow after). */
  deskDay: DayKey;
  /** The dial: deskDay and the four days after it. */
  days: DayKey[];
  sites: Site[];
  regions: string[];
  model: ClosureModel;
  people: Person[];
  /** Cells for the dial days, keyed `${siteId}|${day}`. */
  cells: Map<string, SiteDay>;
  /** Past site-days with a call (day before deskDay), newest day first. */
  past: SiteDay[];
  cell(siteId: string, day: DayKey): SiteDay;
}

export const cellKey = (siteId: string, day: DayKey) => `${siteId}|${day}`;

export function siteTz(site: Site, fallback: string): string {
  return site.timeZone?.trim() || fallback;
}

export function modelInput(site: Site, f: Pick<Forecast, 'snowCm' | 'tempMinC' | 'windKmh' | 'iceRisk'>): ModelInput {
  return {
    snowCm: f.snowCm,
    tempMinC: f.tempMinC,
    windKmh: f.windKmh,
    iceRisk: f.iceRisk,
    elevation: site.elevation,
    exposure: site.exposure,
    roadClass: site.roadClass,
  };
}

const newestFirst = <T>(rows: T[], at: (r: T) => string) => [...rows].sort((a, b) => at(b).localeCompare(at(a)));

/** Sites in globe order: by region (Ridge, Valley, Lakeshore, then others A–Z), then by name. */
export function sortSites(sites: Site[]): Site[] {
  const rank = (r: string) => {
    const i = (REGION_ORDER as readonly string[]).indexOf(r);
    return i < 0 ? REGION_ORDER.length : i;
  };
  return [...sites].sort((a, b) => rank(a.region) - rank(b.region) || a.region.localeCompare(b.region) || a.name.localeCompare(b.name));
}

interface Indexed {
  forecasts: Map<string, Forecast[]>;
  decisions: Map<string, Decision[]>;
  outcomes: Map<string, Outcome[]>;
}

function index(raw: Raw): Indexed {
  const k = (r: { siteId: string; day: string }) => cellKey(r.siteId, dayKey(r.day));
  const sortMap = <T>(m: Map<string, T[]>, at: (r: T) => string) => {
    for (const [key, list] of m) m.set(key, newestFirst(list, at));
    return m;
  };
  return {
    forecasts: sortMap(groupBy(raw.forecasts, k), (f) => f.enteredAt),
    decisions: sortMap(groupBy(raw.decisions, k), (d) => d.decidedAt),
    outcomes: sortMap(groupBy(raw.outcomes, k), (o) => o.enteredAt),
  };
}

/** The forecast the duty manager saw: the newest one entered at or before the call, else the newest. */
function forecastAtCall(forecasts: Forecast[], decision: Decision): Forecast | null {
  return forecasts.find((f) => f.enteredAt <= decision.decidedAt) ?? forecasts[0] ?? null;
}

/**
 * Training rows: every past site-day (before the site's desk day) with a call in force and a forecast. Label 1 when
 * the call was closed or remote. Ordered by day, then site, so the fit is deterministic.
 */
export function trainingRows(raw: Raw, now: Date, tz: string): TrainingRow[] {
  const idx = index(raw);
  const sites = new Map(raw.sites.map((s) => [s.id, s]));
  const rows: { day: string; site: string; row: TrainingRow }[] = [];
  for (const [key, decisions] of idx.decisions) {
    const [siteId, day] = key.split('|');
    const site = sites.get(siteId);
    if (!site) continue;
    if (day >= deskDay(now, siteTz(site, tz))) continue;
    const decision = decisions[0];
    const f = forecastAtCall(idx.forecasts.get(key) ?? [], decision);
    if (!f) continue;
    rows.push({ day, site: site.name, row: { x: modelInput(site, f), y: decision.call === 'closed' || decision.call === 'remote' ? 1 : 0 } });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day) || a.site.localeCompare(b.site));
  return rows.map((r) => r.row);
}

export function buildDesk(raw: Raw, now: Date, tz: string = localTimeZone()): Desk {
  const idx = index(raw);
  const sites = sortSites(raw.sites);
  const model = fitModel(trainingRows(raw, now, tz));
  const days = dialDays(now, tz);

  const makeCell = (site: Site, day: DayKey): SiteDay => {
    const key = cellKey(site.id, day);
    const forecasts = idx.forecasts.get(key) ?? [];
    const history = idx.decisions.get(key) ?? [];
    const outcomes = idx.outcomes.get(key) ?? [];
    const forecast = forecasts[0] ?? null;
    const decision = history[0] ?? null;
    const outcome = outcomes[0] ?? null;
    const probability = forecast ? predict(model, modelInput(site, forecast)) : null;
    const zone = siteTz(site, tz);
    return {
      site,
      day,
      forecast,
      forecasts,
      decision,
      history,
      outcome,
      probability,
      against: decision ? isAgainstModel(decision.call, probability) : false,
      gap: decision && probability !== null ? gapOf(decision.call, probability) : null,
      locked: isLocked(day, zone, now),
      lockAt: lockAt(day, zone).toISOString(),
      verdict: decision && outcome ? verdict(decision.call, outcome) : null,
    };
  };

  const cells = new Map<string, SiteDay>();
  for (const s of sites) for (const d of days) cells.set(cellKey(s.id, d), makeCell(s, d));

  const firstDay = days[0];
  const past: SiteDay[] = [];
  const siteById = new Map(sites.map((s) => [s.id, s]));
  for (const key of idx.decisions.keys()) {
    const [siteId, day] = key.split('|');
    const site = siteById.get(siteId);
    if (!site || day >= firstDay) continue;
    past.push(makeCell(site, day));
  }
  past.sort((a, b) => b.day.localeCompare(a.day) || sites.indexOf(a.site) - sites.indexOf(b.site));

  const regions = [...new Set(sites.map((s) => s.region))];

  return {
    now,
    tz,
    today: dayKeyAt(now, tz),
    deskDay: firstDay,
    days,
    sites,
    regions,
    model,
    people: raw.people,
    cells,
    past,
    cell(siteId: string, day: DayKey) {
      const hit = cells.get(cellKey(siteId, day));
      if (hit) return hit;
      const site = siteById.get(siteId);
      if (!site) throw new Error(`Unknown site ${siteId}`);
      const made = makeCell(site, day);
      cells.set(cellKey(siteId, day), made);
      return made;
    },
  };
}

/** Days a call can be made for on The call: the day before the desk day (locked, for revisions) and the dial. */
export function callDays(desk: Desk): DayKey[] {
  return [addDaysKey(desk.deskDay, -1), ...desk.days];
}

export function nameOf(people: Person[], sub: string | null | undefined): string {
  if (!sub) return '—';
  return people.find((p) => p.sub === sub)?.displayName ?? 'Someone';
}

/** Sites a person leads. */
export function sitesLedBy(sites: Site[], sub: string): Site[] {
  return sites.filter((s) => s.leadSub === sub);
}

/** Mean forecast snow over the sites with a forecast for a day (what the globe's snowfall follows). */
export function meanSnow(cells: SiteDay[]): number {
  const withF = cells.filter((c) => c.forecast);
  if (!withF.length) return 0;
  return withF.reduce((s, c) => s + (c.forecast?.snowCm ?? 0), 0) / withF.length;
}

export function dayCells(desk: Desk, day: DayKey): SiteDay[] {
  return desk.sites.map((s) => desk.cell(s.id, day));
}
