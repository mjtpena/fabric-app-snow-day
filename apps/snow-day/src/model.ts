/**
 * App data types and runtime entity definitions. Keep these in step with rayfin/data/*.ts:
 * every field listed here must exist on the entity class with the matching decorator.
 * Dates are ISO strings in the app; optional fields are `| null`. A `day` is stored as midnight UTC of the site's
 * calendar date ("2026-11-21T00:00:00.000Z"); `dayKey()` in src/domain/time.ts reads it back as "2026-11-21".
 */
import type { EntityDefs } from '@x10/shared/data';
import { AppMarkerDef, PersonDef, type AppMarker, type Person } from '@x10/shared/identity';

export const limits = {
  siteName: { min: 2, max: 80 },
  region: { min: 2, max: 40 },
  timeZone: { max: 40 },
  source: { min: 2, max: 40 },
  reason: { min: 3, max: 400 },
  note: { max: 300 },
  elevation: { min: -100, max: 5000 },
  snowCm: { min: 0, max: 300 },
  tempMinC: { min: -60, max: 30 },
  windKmh: { min: 0, max: 250 },
  incidents: { min: 0, max: 999 },
} as const;

export const EXPOSURES = ['sheltered', 'normal', 'exposed'] as const;
export const ROAD_CLASSES = ['main', 'secondary', 'rural'] as const;
export const ICE_RISKS = ['low', 'medium', 'high'] as const;
export const CALLS = ['open', 'delayed', 'closed', 'remote'] as const;

export type Exposure = (typeof EXPOSURES)[number];
export type RoadClass = (typeof ROAD_CLASSES)[number];
export type IceRisk = (typeof ICE_RISKS)[number];
export type Call = (typeof CALLS)[number];

export interface Site {
  id: string;
  name: string;
  region: string;
  elevation: number;
  exposure: Exposure;
  roadClass: RoadClass;
  leadSub: string | null;
  leadName: string | null;
  timeZone: string | null;
}

export interface Forecast {
  id: string;
  siteId: string;
  day: string;
  snowCm: number;
  tempMinC: number;
  windKmh: number;
  iceRisk: IceRisk;
  source: string;
  enteredBy: string;
  enteredAt: string;
}

export interface Decision {
  id: string;
  siteId: string;
  day: string;
  call: Call;
  reason: string;
  decidedBy: string;
  decidedAt: string;
  modelProbability: number | null;
}

export interface Outcome {
  id: string;
  siteId: string;
  day: string;
  actualSnowCm: number;
  incidents: number;
  note: string | null;
  enteredBy: string;
  enteredAt: string;
}

export type Schema = {
  Person: Person;
  AppMarker: AppMarker;
  Site: Site;
  Forecast: Forecast;
  Decision: Decision;
  Outcome: Outcome;
};

export const defs: EntityDefs<Schema> = {
  Person: PersonDef,
  AppMarker: AppMarkerDef,
  Site: {
    name: 'Site',
    fields: {
      id: 'uuid',
      name: 'text',
      region: 'text',
      elevation: 'int',
      exposure: 'set',
      roadClass: 'set',
      leadSub: 'text',
      leadName: 'text',
      timeZone: 'text',
    },
  },
  Forecast: {
    name: 'Forecast',
    fields: {
      id: 'uuid',
      siteId: 'uuid',
      day: 'date',
      snowCm: 'decimal',
      tempMinC: 'decimal',
      windKmh: 'decimal',
      iceRisk: 'set',
      source: 'text',
      enteredBy: 'text',
      enteredAt: 'date',
    },
  },
  Decision: {
    name: 'Decision',
    fields: {
      id: 'uuid',
      siteId: 'uuid',
      day: 'date',
      call: 'set',
      reason: 'text',
      decidedBy: 'text',
      decidedAt: 'date',
      modelProbability: 'decimal',
    },
  },
  Outcome: {
    name: 'Outcome',
    fields: {
      id: 'uuid',
      siteId: 'uuid',
      day: 'date',
      actualSnowCm: 'decimal',
      incidents: 'int',
      note: 'text',
      enteredBy: 'text',
      enteredAt: 'date',
    },
  },
};
