/**
 * How the lenses colour the town, shared by the globe, the SVG map, the legend and the list. Colours are CSS custom
 * properties from the shared palette (resolved to hex for three.js with cssVar). Pure.
 */
import type { LegendItem } from '@x10/shared/ui';

import { CALL_LABEL, ICE_LABEL, rules } from '../config';
import type { SiteDay } from '../domain/desk';
import type { GlobeLens } from '../domain/today';
import type { Call } from '../model';

export const LENS_LABEL: Record<GlobeLens, string> = {
  probability: 'Probability',
  snow: 'Forecast snow',
  ice: 'Ice risk',
  decision: 'Decision',
  disagreement: 'Disagreement',
};

const PROB_BANDS = [
  { max: 0.2, token: '--sky-7', label: 'Under 20%' },
  { max: 0.4, token: '--sky-9', label: '20–40%' },
  { max: 0.6, token: '--amber-8', label: '40–60%' },
  { max: 0.8, token: '--orange-9', label: '60–80%' },
  { max: 1.01, token: '--crimson-9', label: '80% and over' },
];

const SNOW_BANDS = [
  { max: 0.5, token: '--gray-7', label: 'None' },
  { max: 5, token: '--ice-7', label: 'Under 5 cm' },
  { max: 15, token: '--sky-9', label: '5–15 cm' },
  { max: 25, token: '--blue-10', label: '15–25 cm' },
  { max: Infinity, token: '--violet-10', label: '25 cm and over' },
];

const ICE_TOKEN = { low: '--jade-8', medium: '--amber-9', high: '--crimson-9' } as const;

/** Window light per call: the legend of the decision lens and the globe's windows. */
export const CALL_TOKEN: Record<Call | 'none', string> = {
  open: '--amber-9',
  delayed: '--orange-9',
  closed: '--gray-11',
  remote: '--blue-9',
  none: '--gray-6',
};

const GAP_BANDS = [
  { max: 0.2, token: '--jade-8', label: 'Agrees (gap under 20)' },
  { max: rules.overrideGap + 1e-9, token: '--amber-8', label: `Leans away (20–${Math.round(rules.overrideGap * 100)})` },
  { max: Infinity, token: '--magenta-9', label: `Against the model (over ${Math.round(rules.overrideGap * 100)})` },
];

export const NONE_TOKEN = '--gray-6';

export function lensToken(c: SiteDay, lens: GlobeLens): string {
  switch (lens) {
    case 'probability':
      return c.probability === null ? NONE_TOKEN : PROB_BANDS.find((b) => c.probability! < b.max)!.token;
    case 'snow':
      return c.forecast ? SNOW_BANDS.find((b) => c.forecast!.snowCm < b.max)!.token : NONE_TOKEN;
    case 'ice':
      return c.forecast ? ICE_TOKEN[c.forecast.iceRisk] : NONE_TOKEN;
    case 'decision':
      return CALL_TOKEN[c.decision?.call ?? 'none'];
    case 'disagreement':
      return c.gap === null ? NONE_TOKEN : GAP_BANDS.find((b) => c.gap! < b.max)!.token;
  }
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
export const cm = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)} cm`;

/** The short value chip over each building. */
export function lensValue(c: SiteDay, lens: GlobeLens): string {
  switch (lens) {
    case 'probability':
      return c.probability === null ? 'No forecast' : pct(c.probability);
    case 'snow':
      return c.forecast ? cm(c.forecast.snowCm) : 'No forecast';
    case 'ice':
      return c.forecast ? ICE_LABEL[c.forecast.iceRisk] : 'No forecast';
    case 'decision':
      return c.decision ? CALL_LABEL[c.decision.call] : 'No call';
    case 'disagreement':
      return c.gap === null ? (c.decision ? 'No forecast' : 'No call') : `${Math.round(c.gap * 100)} pt`;
  }
}

/** One sentence per site for its button's accessible name. */
export function siteSummary(c: SiteDay): string {
  const parts = [c.site.name];
  parts.push(c.forecast ? `${cm(c.forecast.snowCm)} forecast` : 'no forecast');
  if (c.probability !== null) parts.push(`${pct(c.probability)} closure`);
  parts.push(c.decision ? `called ${CALL_LABEL[c.decision.call].toLowerCase()}` : 'no call yet');
  if (c.against) parts.push('against the model');
  return parts.join(', ');
}

function count(cells: SiteDay[], pred: (c: SiteDay) => boolean) {
  return cells.filter(pred).length;
}

export function legendItems(cells: SiteDay[], lens: GlobeLens, varFn: (token: string) => string = (t) => `var(${t})`): LegendItem[] {
  const none = (label: string): LegendItem[] => {
    const value = count(cells, (c) => lensToken(c, lens) === NONE_TOKEN);
    return value ? [{ label, color: varFn(NONE_TOKEN), shape: 'ring', value }] : [];
  };
  switch (lens) {
    case 'probability':
      return [
        ...PROB_BANDS.map((b, i) => ({
          label: b.label,
          color: varFn(b.token),
          value: count(cells, (c) => c.probability !== null && c.probability < b.max && (i === 0 || c.probability >= PROB_BANDS[i - 1].max)),
        })),
        ...none('No forecast'),
      ];
    case 'snow':
      return [
        ...SNOW_BANDS.map((b, i) => ({
          label: b.label,
          color: varFn(b.token),
          value: count(cells, (c) => !!c.forecast && c.forecast.snowCm < b.max && (i === 0 || c.forecast.snowCm >= SNOW_BANDS[i - 1].max)),
        })),
        ...none('No forecast'),
      ];
    case 'ice':
      return [
        ...(['low', 'medium', 'high'] as const).map((k) => ({ label: ICE_LABEL[k], color: varFn(ICE_TOKEN[k]), value: count(cells, (c) => c.forecast?.iceRisk === k) })),
        ...none('No forecast'),
      ];
    case 'decision':
      return [
        ...(['open', 'delayed', 'closed', 'remote'] as const).map((k) => ({
          label: CALL_LABEL[k],
          color: varFn(CALL_TOKEN[k]),
          shape: 'square' as const,
          value: count(cells, (c) => c.decision?.call === k),
        })),
        { label: 'No call yet', color: varFn(CALL_TOKEN.none), shape: 'ring' as const, value: count(cells, (c) => !c.decision) },
      ];
    case 'disagreement':
      return [
        ...GAP_BANDS.map((b, i) => ({
          label: b.label,
          color: varFn(b.token),
          value: count(cells, (c) => c.gap !== null && c.gap < b.max && (i === 0 || c.gap >= GAP_BANDS[i - 1].max)),
        })),
        ...none('No call or forecast'),
      ];
  }
}
