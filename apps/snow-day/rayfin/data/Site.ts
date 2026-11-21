import { entity, int, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * One place that can close for snow: a school, a depot, an office.
 *
 * Row security (see README "Security model"):
 * - read: every signed-in user.
 * - create / update: open to signed-in users at the database level, because the policy DSL has no admin claim.
 *   "Only the duty manager (an admin) adds or edits sites" is enforced in src/domain/actions.ts and listed under
 *   Known limits.
 * - delete: not granted (decisions and outcomes point at sites; a site is never removed from the record).
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', ['create', 'update'])
export class Site {
  @uuid() id!: string;
  @text({ min: 2, max: 80 }) name!: string;
  @text({ min: 2, max: 40 }) region!: string;
  @int() elevation!: number;
  @set('sheltered', 'normal', 'exposed') exposure!: 'sheltered' | 'normal' | 'exposed';
  @set('main', 'secondary', 'rural') roadClass!: 'main' | 'secondary' | 'rural';
  @text({ max: 255, optional: true }) leadSub?: string;
  @text({ max: 100, optional: true }) leadName?: string;
  /** IANA time zone for the 09:00 lock ("Europe/Oslo"). Empty = the desk's own time zone. */
  @text({ max: 40, optional: true }) timeZone?: string;
}
