/**
 * The Today panel, ranked. Every entry points at a site (or a day) on the globe and the lens that explains it.
 * Duty manager: sites above 60% with no call yet, calls against the model, sites missing a forecast, the 09:00 lock,
 * and the heaviest snow ahead. Site lead: the same, narrowed to the sites they lead, plus outcomes to record.
 */
import { rules } from '../config';
import { dayCells, type Desk, type SiteDay } from './desk';
import { dayRelative, lockAt, type DayKey } from './time';

export type GlobeLens = 'probability' | 'snow' | 'ice' | 'decision' | 'disagreement';
export type Perspective = 'duty' | 'lead';

export interface TodayEntry {
  id: string;
  title: string;
  severity: 'bad' | 'warn' | 'info' | 'ok' | 'neutral';
  value?: string;
  unit?: string;
  lens: GlobeLens;
  meta?: string;
  /** Site to focus (null = the whole globe). */
  siteId: string | null;
  /** Day to turn the dial to. */
  day: DayKey;
}

const names = (cells: SiteDay[], n = 3) => {
  const list = cells.slice(0, n).map((c) => c.site.name);
  return cells.length > n ? `${list.join(', ')} and ${cells.length - n} more` : list.join(', ');
};

/** "today", "tomorrow" or "on Thu 27 Nov". */
export function onDay(day: DayKey, today: DayKey): string {
  const rel = dayRelative(day, today);
  return rel === 'Today' || rel === 'Tomorrow' || rel === 'Yesterday' ? rel.toLowerCase() : `on ${rel}`;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

function formatLeft(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

export function todayEntries(desk: Desk, perspective: Perspective, mySub: string): TodayEntry[] {
  const day = desk.deskDay;
  const mine = (c: SiteDay) => perspective === 'duty' || c.site.leadSub === mySub;
  const cells = dayCells(desk, day).filter(mine);
  const out: TodayEntry[] = [];
  const rel = dayRelative(day, desk.today);
  const relLower = onDay(day, desk.today).replace(/^on /, '');

  // 1. Likely closures with no call yet.
  const uncalled = cells
    .filter((c) => !c.decision && c.probability !== null && c.probability >= rules.todayProbability)
    .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
  if (uncalled.length)
    out.push({
      id: 'uncalled',
      title:
        uncalled.length === 1
          ? `${uncalled[0].site.name} is at ${pct(uncalled[0].probability!)} with no call for ${relLower}`
          : `${uncalled.length} sites above ${pct(rules.todayProbability)} with no call for ${relLower}`,
      severity: 'bad',
      value: uncalled.length === 1 ? pct(uncalled[0].probability!) : String(uncalled.length),
      unit: uncalled.length === 1 ? 'closure' : 'sites',
      lens: 'probability',
      meta: uncalled.length === 1 ? uncalled[0].site.region : names(uncalled),
      siteId: uncalled[0].site.id,
      day,
    });

  // 2. Calls against the model (the biggest gap first).
  const against = cells.filter((c) => c.against).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0));
  if (against.length) {
    const top = against[0];
    out.push({
      id: 'against',
      title:
        against.length === 1
          ? `${top.site.name}: called ${top.decision!.call} at ${pct(top.probability!)} closure`
          : `${against.length} calls go against the model`,
      severity: 'warn',
      value: `${Math.round((top.gap ?? 0) * 100)}`,
      unit: 'pt gap',
      lens: 'disagreement',
      meta: against.length === 1 ? 'Reason on record' : names(against),
      siteId: top.site.id,
      day,
    });
  }

  // 3. Sites missing a forecast on any dial day (the desk day first).
  const missing = desk.sites
    .filter((s) => perspective === 'duty' || s.leadSub === mySub)
    .map((s) => ({ site: s, days: desk.days.filter((d) => !desk.cell(s.id, d).forecast) }))
    .filter((m) => m.days.length)
    .sort((a, b) => Number(b.days.includes(day)) - Number(a.days.includes(day)) || b.days.length - a.days.length);
  if (missing.length) {
    const first = missing[0];
    const missingToday = missing.filter((m) => m.days.includes(day)).length;
    out.push({
      id: 'missing',
      title:
        missing.length === 1
          ? `${first.site.name} has no forecast for ${first.days.length === 1 ? dayRelative(first.days[0], desk.today).toLowerCase() : `${first.days.length} days`}`
          : `${missing.length} sites are missing a forecast`,
      severity: missingToday ? 'bad' : 'warn',
      value: String(missing.reduce((s, m) => s + m.days.length, 0)),
      unit: 'days missing',
      lens: 'snow',
      meta: missing.length === 1 ? first.site.region : missing.map((m) => m.site.name).slice(0, 3).join(', '),
      siteId: first.site.id,
      day: first.days[0],
    });
  }

  // 4. Site leads: outcomes to record for past calls at their sites.
  if (perspective === 'lead') {
    const todo = desk.past.filter((c) => c.site.leadSub === mySub && c.decision && !c.outcome && c.day < desk.today);
    if (todo.length)
      out.push({
        id: 'outcomes',
        title: todo.length === 1 ? `Record what ${dayRelative(todo[0].day, desk.today).toLowerCase()} brought at ${todo[0].site.name}` : `${todo.length} past calls have no outcome`,
        severity: 'warn',
        value: String(todo.length),
        unit: 'outcomes',
        lens: 'decision',
        meta: 'Snow on the ground and incidents',
        siteId: todo[0].site.id,
        day,
      });
  }

  // 5. The 09:00 lock.
  const called = cells.filter((c) => c.decision).length;
  const lockMs = cells.length ? Math.min(...cells.map((c) => new Date(c.lockAt).getTime())) : lockAt(day, desk.tz).getTime();
  const left = lockMs - desk.now.getTime();
  out.push({
    id: 'lock',
    title: `${rel}'s calls lock at 09:00`,
    severity: left < 60 * 60_000 && called < cells.length ? 'bad' : called < cells.length ? 'warn' : 'ok',
    value: formatLeft(left),
    unit: 'to lock',
    lens: 'decision',
    meta: `${called} of ${cells.length} called`,
    siteId: null,
    day,
  });

  // 6. The heaviest snow ahead (the storm), when there is any.
  let peak: SiteDay | null = null;
  for (const d of desk.days)
    for (const c of dayCells(desk, d).filter(mine))
      if (c.forecast && (!peak || c.forecast.snowCm > (peak.forecast?.snowCm ?? 0))) peak = c;
  if (peak?.forecast && peak.forecast.snowCm >= 5)
    out.push({
      id: 'peak',
      title: `Heaviest snow: ${Math.round(peak.forecast.snowCm)} cm at ${peak.site.name} ${onDay(peak.day, desk.today)}`,
      severity: 'info',
      value: String(Math.round(peak.forecast.snowCm)),
      unit: 'cm',
      lens: 'snow',
      meta: `${pct(peak.probability ?? 0)} closure`,
      siteId: peak.site.id,
      day: peak.day,
    });

  return out.slice(0, 5);
}
