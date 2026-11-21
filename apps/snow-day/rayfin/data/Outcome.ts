import { date, decimal, entity, int, role, text, uuid } from '@microsoft/rayfin-core';

/**
 * What the day actually brought at a site: snow on the ground and incidents. Append-only like the rest of the record:
 * a correction is a newer outcome for the same site and day.
 *
 * Row security:
 * - read: every signed-in user.
 * - create: only as yourself (enteredBy = caller). "Site leads for their own sites, the duty manager for any" is
 *   enforced in src/domain/actions.ts.
 * - update / delete: not granted.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.enteredBy),
})
export class Outcome {
  @uuid() id!: string;
  @uuid() siteId!: string;
  @date() day!: Date;
  @decimal() actualSnowCm!: number;
  @int() incidents!: number;
  @text({ max: 300, optional: true }) note?: string;
  @text({ min: 1, max: 255 }) enteredBy!: string;
  @date() enteredAt!: Date;
}
