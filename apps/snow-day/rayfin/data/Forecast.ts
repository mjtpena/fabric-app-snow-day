import { date, decimal, entity, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * One forecast for one site and day, as entered at the weather station. Append-only: a newer forecast for the same
 * site and day supersedes the older one, and the old one stays in the record.
 *
 * Row security:
 * - read: every signed-in user.
 * - create: only as yourself (enteredBy = caller). "Site leads enter forecasts for their own sites; the duty manager
 *   for any site" is enforced in src/domain/actions.ts (there is no admin claim).
 * - update / delete: not granted.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.enteredBy),
})
export class Forecast {
  @uuid() id!: string;
  @uuid() siteId!: string;
  @date() day!: Date;
  @decimal() snowCm!: number;
  @decimal() tempMinC!: number;
  @decimal() windKmh!: number;
  @set('low', 'medium', 'high') iceRisk!: 'low' | 'medium' | 'high';
  @text({ min: 2, max: 40 }) source!: string;
  @text({ min: 1, max: 255 }) enteredBy!: string;
  @date() enteredAt!: Date;
}
