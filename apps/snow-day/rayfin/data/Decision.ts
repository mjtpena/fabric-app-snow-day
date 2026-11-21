import { date, decimal, entity, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * The call for one site and day, with its reason and the model's probability at the time. Append-only: the latest
 * decision for a site and day is the call in force; a change after the 09:00 lock is a new decision whose reason
 * says "Revised".
 *
 * Row security:
 * - read: every signed-in user.
 * - create: only as yourself (decidedBy = caller). "Only the duty manager makes the call", the override reason and
 *   the revision rule are enforced in src/domain/actions.ts.
 * - update / delete: not granted. The record cannot be rewritten.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.decidedBy),
})
export class Decision {
  @uuid() id!: string;
  @uuid() siteId!: string;
  @date() day!: Date;
  @set('open', 'delayed', 'closed', 'remote') call!: 'open' | 'delayed' | 'closed' | 'remote';
  @text({ min: 3, max: 400 }) reason!: string;
  @text({ min: 1, max: 255 }) decidedBy!: string;
  @date() decidedAt!: Date;
  @decimal({ optional: true }) modelProbability?: number;
}
