/**
 * Site-time arithmetic. A "day key" is a calendar date in the site's time zone ("2026-11-21"); it is stored as
 * midnight UTC of that date so it reads back the same everywhere. Calls lock at 09:00 site time (rules.lockHour).
 * Pure: every function takes `now` and the time zone explicitly.
 */
import { rules } from '../config';

export type DayKey = string;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** The viewer's own time zone (the desk's default when a site has none). */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** True when the runtime knows this IANA zone. */
export function isTimeZone(tz: string): boolean {
  try {
    partsFmt(tz);
    return true;
  } catch {
    return false;
  }
}

function zoned(ms: number, tz: string) {
  const p: Record<string, number> = {};
  for (const part of partsFmt(tz).formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

/** Offset of the zone from UTC at an instant, in ms (positive east of Greenwich). */
export function zoneOffsetMs(ms: number, tz: string): number {
  const z = zoned(ms, tz);
  const asUtc = Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Calendar date of an instant in a zone. */
export function dayKeyAt(instant: string | Date | number, tz: string): DayKey {
  const ms = typeof instant === 'number' ? instant : new Date(instant).getTime();
  const z = zoned(ms, tz);
  return `${z.y}-${pad(z.m)}-${pad(z.d)}`;
}

/** Hour and minute of an instant in a zone. */
export function clockAt(instant: string | Date | number, tz: string): { h: number; m: number } {
  const ms = typeof instant === 'number' ? instant : new Date(instant).getTime();
  const z = zoned(ms, tz);
  return { h: z.h, m: z.mi };
}

/** The UTC instant of a wall-clock time on a calendar date in a zone (handles DST by re-checking the offset). */
export function zonedInstant(day: DayKey, hour: number, minute: number, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let ms = guess - zoneOffsetMs(guess, tz);
  const again = guess - zoneOffsetMs(ms, tz);
  if (again !== ms) ms = again;
  return new Date(ms);
}

export function addDaysKey(day: DayKey, n: number): DayKey {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from a to b. */
export function daysBetweenKeys(a: DayKey, b: DayKey): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Stored form of a day key. */
export function dayIso(day: DayKey): string {
  return `${day}T00:00:00.000Z`;
}

/** Day key of a stored day (an ISO string at midnight UTC). */
export function dayKey(iso: string): DayKey {
  return iso.slice(0, 10);
}

export function isDayKey(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return addDaysKey(v, 0) === v;
}

/** When calls for a day lock: 09:00 on that date, site time. */
export function lockAt(day: DayKey, tz: string): Date {
  return zonedInstant(day, rules.lockHour, 0, tz);
}

export function isLocked(day: DayKey, tz: string, now: Date): boolean {
  return now.getTime() >= lockAt(day, tz).getTime();
}

/**
 * The first day whose calls are still open: today before 09:00, tomorrow after. The dial starts here, and "today's
 * calls" in the Today panel are this day's.
 */
export function deskDay(now: Date, tz: string): DayKey {
  const today = dayKeyAt(now, tz);
  return isLocked(today, tz, now) ? addDaysKey(today, 1) : today;
}

/** The dial: `rules.forecastDays` days from the desk day. */
export function dialDays(now: Date, tz: string): DayKey[] {
  const first = deskDay(now, tz);
  return Array.from({ length: rules.forecastDays }, (_, i) => addDaysKey(first, i));
}

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const yearFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "Thu", "27 Nov", "Thursday 27 November", "27 Nov 2025". */
export function dayWeekday(day: DayKey): string {
  return weekday.format(Date.parse(`${day}T12:00:00Z`));
}
export function dayShort(day: DayKey): string {
  return dayMonth.format(Date.parse(`${day}T12:00:00Z`));
}
export function dayLong(day: DayKey): string {
  return longFmt.format(Date.parse(`${day}T12:00:00Z`));
}
export function dayWithYear(day: DayKey): string {
  return yearFmt.format(Date.parse(`${day}T12:00:00Z`));
}

/** "Today", "Tomorrow", "Yesterday" or "Thu 27 Nov", relative to the calendar date `today`. */
export function dayRelative(day: DayKey, today: DayKey): string {
  const d = daysBetweenKeys(today, day);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return `${dayWeekday(day)} ${dayShort(day)}`;
}

/** The winter a day belongs to: "2025–26" for 1 Jul 2025 to 30 Jun 2026. */
export function winterOf(day: DayKey): string {
  const [y, m] = day.split('-').map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}–${String((start + 1) % 100).padStart(2, '0')}`;
}
