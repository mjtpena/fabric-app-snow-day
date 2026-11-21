/**
 * Store-facing domain functions: load the desk, log forecasts (one or a CSV), make the call, record outcomes and
 * manage sites. Every permission and rule check lives here so it holds in demo mode and in Fabric alike; components
 * never touch the store.
 */
import { PermissionError, RuleError, type DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { checkText, parseCsv } from '@x10/shared/lib';

import { CALL_LABEL } from '../config';
import { EXPOSURES, ICE_RISKS, limits, ROAD_CLASSES, type Call, type Decision, type Exposure, type Forecast, type IceRisk, type Outcome, type RoadClass, type Schema, type Site } from '../model';
import { buildDesk, siteTz, type Desk, type Raw } from './desk';
import { checkCall } from './rules';
import { addDaysKey, dayIso, dayKeyAt, isDayKey, isTimeZone, localTimeZone, type DayKey } from './time';

type Store = DataStore<Schema>;

export async function loadRaw(store: Store): Promise<Raw> {
  const [sites, forecasts, decisions, outcomes, people] = await Promise.all([
    store.repo('Site').list(),
    store.repo('Forecast').list(),
    store.repo('Decision').list(),
    store.repo('Outcome').list(),
    store.repo('Person').list(),
  ]);
  return { sites, forecasts, decisions, outcomes, people };
}

export async function loadDesk(store: Store, now = new Date(), tz = localTimeZone()): Promise<Desk> {
  return buildDesk(await loadRaw(store), now, tz);
}

const isAdmin = (me: Person) => me.isAdmin === true;

/** May this person enter forecasts and outcomes for the site? The duty manager for any, a lead for their own. */
export function canReport(me: Person, site: Site): boolean {
  return isAdmin(me) || (!!site.leadSub && site.leadSub === me.sub);
}

async function getSite(store: Store, id: string): Promise<Site> {
  const site = await store.repo('Site').get(id);
  if (!site) throw new RuleError('That site no longer exists.');
  return site;
}

/* ------------------------------------------------------------------ forecasts */

export interface ForecastInput {
  siteId: string;
  day: DayKey;
  snowCm: number;
  tempMinC: number;
  windKmh: number;
  iceRisk: IceRisk;
  source: string;
}

export type ForecastErrors = Partial<Record<keyof ForecastInput, string>>;

function rangeError(v: number, r: { min: number; max: number }, label: string, unit: string): string | null {
  if (!Number.isFinite(v)) return `${label} must be a number.`;
  if (v < r.min || v > r.max) return `${label} must be between ${r.min} and ${r.max} ${unit}.`;
  return null;
}

/** Field errors for a forecast (empty when valid). `today` bounds how far ahead a forecast may go (14 days). */
export function validateForecast(f: ForecastInput, today: DayKey): ForecastErrors {
  const e: ForecastErrors = {};
  if (!f.siteId) e.siteId = 'Choose a site.';
  if (!isDayKey(f.day)) e.day = 'Choose a day.';
  else if (f.day > addDaysKey(today, 14)) e.day = 'Forecasts go at most 14 days ahead.';
  const snow = rangeError(f.snowCm, limits.snowCm, 'Snow', 'cm');
  if (snow) e.snowCm = snow;
  const temp = rangeError(f.tempMinC, limits.tempMinC, 'Minimum temperature', '°C');
  if (temp) e.tempMinC = temp;
  const wind = rangeError(f.windKmh, limits.windKmh, 'Wind', 'km/h');
  if (wind) e.windKmh = wind;
  if (!(ICE_RISKS as readonly string[]).includes(f.iceRisk)) e.iceRisk = 'Ice risk is low, medium or high.';
  const src = checkText(f.source, { ...limits.source, label: 'Source' });
  if (src) e.source = src;
  return e;
}

export async function logForecast(store: Store, me: Person, input: ForecastInput, now = new Date()): Promise<Forecast> {
  const site = await getSite(store, input.siteId);
  if (!canReport(me, site)) throw new PermissionError(`Only ${site.leadName ?? 'the site lead'} or the duty manager can enter forecasts for ${site.name}.`);
  const errors = validateForecast(input, dayKeyAt(now, siteTz(site, localTimeZone())));
  const first = Object.values(errors)[0];
  if (first) throw new RuleError(first);
  return store.repo('Forecast').create({
    siteId: site.id,
    day: dayIso(input.day),
    snowCm: round1(input.snowCm),
    tempMinC: round1(input.tempMinC),
    windKmh: round1(input.windKmh),
    iceRisk: input.iceRisk,
    source: input.source.trim(),
    enteredBy: me.sub,
    enteredAt: now.toISOString(),
  });
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/* ------------------------------------------------------------------ CSV import */

export const CSV_HEADERS = ['site', 'day', 'snow_cm', 'temp_min_c', 'wind_kmh', 'ice_risk', 'source'] as const;
const HEADER_ALIASES: Record<string, (typeof CSV_HEADERS)[number]> = {
  site: 'site',
  sitename: 'site',
  day: 'day',
  date: 'day',
  snow: 'snow_cm',
  snowcm: 'snow_cm',
  tempmin: 'temp_min_c',
  tempminc: 'temp_min_c',
  mintemp: 'temp_min_c',
  wind: 'wind_kmh',
  windkmh: 'wind_kmh',
  ice: 'ice_risk',
  icerisk: 'ice_risk',
  source: 'source',
};

export interface CsvRow {
  line: number;
  input: ForecastInput | null;
  siteName: string;
  error: string | null;
}

/**
 * Parse a forecast CSV: a header row naming the columns (site, day, snow_cm, temp_min_c, wind_kmh, ice_risk, source;
 * case, spaces and underscores ignored), then one row per site and day. Sites match by name (case-insensitive) or id.
 * Every row comes back with its own error, so the preview can show exactly what will and will not import.
 */
export function parseForecastCsv(text: string, sites: Site[], today: DayKey, canWrite: (s: Site) => boolean = () => true): { rows: CsvRow[]; headerError: string | null } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], headerError: 'The file is empty.' };
  const header = table[0].map((h) => HEADER_ALIASES[h.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? null);
  const missing = CSV_HEADERS.filter((h) => !header.includes(h));
  if (missing.length) return { rows: [], headerError: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` };
  const col = (row: string[], name: (typeof CSV_HEADERS)[number]) => (row[header.indexOf(name)] ?? '').trim();
  const rows: CsvRow[] = table.slice(1).map((row, i) => {
    const line = i + 2;
    const siteName = col(row, 'site');
    const site = sites.find((s) => s.id === siteName || s.name.toLowerCase() === siteName.toLowerCase());
    if (!site) return { line, input: null, siteName, error: siteName ? `No site called “${siteName}”.` : 'Site is empty.' };
    if (!canWrite(site)) return { line, input: null, siteName: site.name, error: `You can only enter forecasts for your own sites.` };
    const num = (v: string) => (v === '' ? Number.NaN : Number(v.replace(',', '.')));
    const ice = col(row, 'ice_risk').toLowerCase() as IceRisk;
    const input: ForecastInput = {
      siteId: site.id,
      day: col(row, 'day'),
      snowCm: num(col(row, 'snow_cm')),
      tempMinC: num(col(row, 'temp_min_c')),
      windKmh: num(col(row, 'wind_kmh')),
      iceRisk: ice,
      source: col(row, 'source'),
    };
    const errors = validateForecast(input, today);
    const first = Object.values(errors)[0] ?? null;
    return { line, input: first ? null : input, siteName: site.name, error: first };
  });
  return { rows, headerError: null };
}

export async function importForecasts(store: Store, me: Person, text: string, now = new Date()): Promise<{ imported: number; skipped: CsvRow[] }> {
  const sites = await store.repo('Site').list();
  const { rows, headerError } = parseForecastCsv(text, sites, dayKeyAt(now, localTimeZone()), (s) => canReport(me, s));
  if (headerError) throw new RuleError(headerError);
  const good = rows.filter((r) => r.input);
  if (!good.length) throw new RuleError('No row in the file can be imported.');
  for (const r of good) await logForecast(store, me, r.input!, now);
  return { imported: good.length, skipped: rows.filter((r) => !r.input) };
}

/* ------------------------------------------------------------------ the call */

export interface CallInput {
  siteId: string;
  day: DayKey;
  call: Call;
  reason: string;
}

export async function makeCall(store: Store, me: Person, input: CallInput, now = new Date()): Promise<{ decision: Decision; revision: boolean; against: boolean }> {
  if (!isAdmin(me)) throw new PermissionError('Only the duty manager makes the call.');
  const desk = await loadDesk(store, now);
  if (!desk.sites.some((s) => s.id === input.siteId)) throw new RuleError('That site no longer exists.');
  if (!isDayKey(input.day)) throw new RuleError('Choose a day.');
  if (input.day > desk.days[desk.days.length - 1]) throw new RuleError('Calls can be made for the next five days at most.');
  const cell = desk.cell(input.siteId, input.day);
  const check = checkCall({ call: input.call, reason: input.reason, probability: cell.probability, current: cell.decision?.call ?? null, locked: cell.locked });
  if (check.error) throw new RuleError(check.error);
  const decision = await store.repo('Decision').create({
    siteId: input.siteId,
    day: dayIso(input.day),
    call: input.call,
    reason: check.reason,
    decidedBy: me.sub,
    decidedAt: now.toISOString(),
    modelProbability: cell.probability === null ? null : Math.round(cell.probability * 1000) / 1000,
  });
  return { decision, revision: check.revision, against: check.against };
}

export function callLabel(call: Call): string {
  return CALL_LABEL[call];
}

/* ------------------------------------------------------------------ outcomes */

export interface OutcomeInput {
  siteId: string;
  day: DayKey;
  actualSnowCm: number;
  incidents: number;
  note: string;
}

export function validateOutcome(o: OutcomeInput, today: DayKey): Partial<Record<keyof OutcomeInput, string>> {
  const e: Partial<Record<keyof OutcomeInput, string>> = {};
  if (!isDayKey(o.day)) e.day = 'Choose a day.';
  else if (o.day > today) e.day = 'Record an outcome once the day has come.';
  const snow = rangeError(o.actualSnowCm, limits.snowCm, 'Snow on the ground', 'cm');
  if (snow) e.actualSnowCm = snow;
  if (!Number.isInteger(o.incidents)) e.incidents = 'Incidents is a whole number.';
  else {
    const inc = rangeError(o.incidents, limits.incidents, 'Incidents', '');
    if (inc) e.incidents = inc.trim().replace(/ \.$/, '.');
  }
  const note = checkText(o.note, { max: limits.note.max, optional: true, label: 'Note' });
  if (note) e.note = note;
  return e;
}

export async function recordOutcome(store: Store, me: Person, input: OutcomeInput, now = new Date()): Promise<Outcome> {
  const site = await getSite(store, input.siteId);
  if (!canReport(me, site)) throw new PermissionError(`Only ${site.leadName ?? 'the site lead'} or the duty manager can record outcomes for ${site.name}.`);
  const errors = validateOutcome(input, dayKeyAt(now, siteTz(site, localTimeZone())));
  const first = Object.values(errors)[0];
  if (first) throw new RuleError(first);
  return store.repo('Outcome').create({
    siteId: site.id,
    day: dayIso(input.day),
    actualSnowCm: round1(input.actualSnowCm),
    incidents: input.incidents,
    note: input.note.trim() || null,
    enteredBy: me.sub,
    enteredAt: now.toISOString(),
  });
}

/* ------------------------------------------------------------------ sites */

export interface SiteInput {
  name: string;
  region: string;
  elevation: number;
  exposure: Exposure;
  roadClass: RoadClass;
  leadSub: string | null;
  timeZone: string;
}

export function validateSite(s: SiteInput, others: Site[]): Partial<Record<keyof SiteInput, string>> {
  const e: Partial<Record<keyof SiteInput, string>> = {};
  const name = checkText(s.name, { ...limits.siteName, label: 'Name' });
  if (name) e.name = name;
  else if (others.some((o) => o.name.trim().toLowerCase() === s.name.trim().toLowerCase())) e.name = 'Another site already has this name.';
  const region = checkText(s.region, { ...limits.region, label: 'Region' });
  if (region) e.region = region;
  if (!Number.isInteger(s.elevation)) e.elevation = 'Elevation is a whole number of metres.';
  else {
    const el = rangeError(s.elevation, limits.elevation, 'Elevation', 'm');
    if (el) e.elevation = el;
  }
  if (!(EXPOSURES as readonly string[]).includes(s.exposure)) e.exposure = 'Choose an exposure.';
  if (!(ROAD_CLASSES as readonly string[]).includes(s.roadClass)) e.roadClass = 'Choose a road class.';
  const tz = s.timeZone.trim();
  if (tz.length > limits.timeZone.max) e.timeZone = `Time zone must be ${limits.timeZone.max} characters or fewer.`;
  else if (tz && !isTimeZone(tz)) e.timeZone = 'Not a time zone this browser knows (use a name like Europe/Oslo).';
  return e;
}

export async function saveSite(store: Store, me: Person, input: SiteInput, id?: string): Promise<Site> {
  if (!isAdmin(me)) throw new PermissionError('Only the duty manager adds or edits sites.');
  const all = await store.repo('Site').list();
  const errors = validateSite(input, all.filter((s) => s.id !== id));
  const first = Object.values(errors)[0];
  if (first) throw new RuleError(first);
  const people = await store.repo('Person').list();
  const lead = input.leadSub ? people.find((p) => p.sub === input.leadSub) : null;
  if (input.leadSub && !lead) throw new RuleError('That lead is not a user of this app yet.');
  const row = {
    name: input.name.trim(),
    region: input.region.trim(),
    elevation: input.elevation,
    exposure: input.exposure,
    roadClass: input.roadClass,
    leadSub: lead?.sub ?? null,
    leadName: lead?.displayName ?? null,
    timeZone: input.timeZone.trim() || null,
  };
  return id ? store.repo('Site').update(id, row) : store.repo('Site').create(row);
}
