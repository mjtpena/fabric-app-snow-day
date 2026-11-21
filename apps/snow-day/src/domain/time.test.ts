import { addDaysKey, clockAt, dayKey, dayKeyAt, dayRelative, daysBetweenKeys, deskDay, dialDays, isDayKey, isLocked, isTimeZone, lockAt, winterOf, zonedInstant } from './time';

describe('site time', () => {
  it('reads the calendar date and clock in a zone', () => {
    const t = new Date('2026-11-20T23:30:00Z');
    expect(dayKeyAt(t, 'UTC')).toBe('2026-11-20');
    expect(dayKeyAt(t, 'Europe/Oslo')).toBe('2026-11-21');
    expect(dayKeyAt(t, 'America/Denver')).toBe('2026-11-20');
    expect(clockAt(t, 'Europe/Oslo')).toEqual({ h: 0, m: 30 });
  });

  it('finds the UTC instant of a wall-clock time, across DST', () => {
    expect(zonedInstant('2026-11-21', 9, 0, 'Europe/Oslo').toISOString()).toBe('2026-11-21T08:00:00.000Z');
    expect(zonedInstant('2026-07-01', 9, 0, 'Europe/Oslo').toISOString()).toBe('2026-07-01T07:00:00.000Z');
    expect(zonedInstant('2026-11-21', 9, 0, 'Australia/Sydney').toISOString()).toBe('2026-11-20T22:00:00.000Z');
    expect(zonedInstant('2026-01-15', 9, 0, 'America/Denver').toISOString()).toBe('2026-01-15T16:00:00.000Z');
  });

  it('locks a day at 09:00 site time', () => {
    expect(lockAt('2026-11-21', 'UTC').toISOString()).toBe('2026-11-21T09:00:00.000Z');
    expect(isLocked('2026-11-21', 'UTC', new Date('2026-11-21T08:59:59Z'))).toBe(false);
    expect(isLocked('2026-11-21', 'UTC', new Date('2026-11-21T09:00:00Z'))).toBe(true);
    // 09:00 in Oslo is 08:00 UTC in winter.
    expect(isLocked('2026-11-21', 'Europe/Oslo', new Date('2026-11-21T08:30:00Z'))).toBe(true);
  });

  it('the desk day is today before 09:00 and tomorrow after', () => {
    expect(deskDay(new Date('2026-11-21T05:00:00Z'), 'UTC')).toBe('2026-11-21');
    expect(deskDay(new Date('2026-11-21T09:00:00Z'), 'UTC')).toBe('2026-11-22');
    expect(dialDays(new Date('2026-11-21T05:00:00Z'), 'UTC')).toEqual(['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']);
  });

  it('day keys', () => {
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetweenKeys('2026-11-20', '2026-11-25')).toBe(5);
    expect(dayKey('2026-11-21T00:00:00.000Z')).toBe('2026-11-21');
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('2026-02-28')).toBe(true);
    expect(isDayKey('28/02/2026')).toBe(false);
    expect(dayRelative('2026-11-21', '2026-11-21')).toBe('Today');
    expect(dayRelative('2026-11-22', '2026-11-21')).toBe('Tomorrow');
    expect(dayRelative('2026-11-20', '2026-11-21')).toBe('Yesterday');
    expect(dayRelative('2026-11-24', '2026-11-21')).toBe('Tue 24 Nov');
    expect(winterOf('2026-01-10')).toBe('2025–26');
    expect(winterOf('2026-12-10')).toBe('2026–27');
    expect(isTimeZone('Europe/Oslo')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });
});
