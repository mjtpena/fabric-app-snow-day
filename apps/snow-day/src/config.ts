/**
 * Every rule and threshold Snow Day uses, in one place. The About page reads these, so what it says is what runs.
 * No React here (the seed tool loads this file in Node).
 */
import type { Call, Exposure, IceRisk, RoadClass } from './model';

export const rules = {
  /** A call that differs from the model's probability by more than this needs a longer reason (rule 2). */
  overrideGap: 0.35,
  /** Reason length for a call against the model, and for a revision after the lock. */
  overrideReasonMin: 30,
  /** Calls for a day lock at this hour, site time (rule 3). */
  lockHour: 9,
  /** Fewer past decisions than this and the model uses the hand-set prior (rule 1). */
  minHistory: 15,
  /** How strongly the fit is pulled toward the prior (ridge penalty on standardised coefficients). */
  priorStrength: 2,
  /** Today: sites above this probability with no call yet. */
  todayProbability: 0.6,
  /** Days of forecast on the dial. */
  forecastDays: 5,
  /** Hit rate (rule 4). Over-cautious: closed or remote, under this much snow and at most `lowIncidents`. */
  overCautiousSnowCm: 2,
  lowIncidents: 1,
  /** Caught out: open on a day with at least this much snow, or open or delayed with at least this many incidents. */
  caughtOutSnowCm: 10,
  caughtOutIncidents: 3,
  /** The model's own call for the hindsight comparison: close at or above this probability. */
  modelCloseAt: 0.5,
} as const;

/** How far each call is from "open" when it is compared with the model's closure probability. */
export const CALL_WEIGHT: Record<Call, number> = { open: 0, delayed: 0.5, closed: 1, remote: 1 };

export const CALL_LABEL: Record<Call, string> = { open: 'Open', delayed: 'Delayed', closed: 'Closed', remote: 'Remote' };
export const CALL_LIGHT: Record<Call, string> = {
  open: 'Warm windows: open as normal',
  delayed: 'Amber windows: opening late',
  closed: 'Dark windows: closed',
  remote: 'Blue windows: working remotely',
};
export const ICE_LABEL: Record<IceRisk, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export const EXPOSURE_LABEL: Record<Exposure, string> = { sheltered: 'Sheltered', normal: 'Normal', exposed: 'Exposed' };
export const ROAD_LABEL: Record<RoadClass, string> = { main: 'Main road', secondary: 'Secondary road', rural: 'Rural road' };

/** Ordinal levels the model uses for the categorical inputs. */
export const ICE_LEVEL: Record<IceRisk, number> = { low: 0, medium: 1, high: 2 };
export const EXPOSURE_LEVEL: Record<Exposure, number> = { sheltered: 0, normal: 1, exposed: 2 };
export const ROAD_LEVEL: Record<RoadClass, number> = { main: 0, secondary: 1, rural: 2 };

export const FEATURES = ['snow', 'cold', 'wind', 'ice', 'elevation', 'exposure', 'road'] as const;
export type Feature = (typeof FEATURES)[number];

/** What one unit of each model input is, and what a positive coefficient means. */
export const FEATURE_INFO: Record<Feature, { label: string; unit: string; meaning: string }> = {
  snow: { label: 'Snow', unit: 'per cm forecast', meaning: 'More forecast snow, more likely to close.' },
  cold: { label: 'Cold', unit: 'per °C below zero', meaning: 'Colder nights keep snow and ice on the roads (minimum temperature, sign flipped).' },
  wind: { label: 'Wind', unit: 'per km/h', meaning: 'Wind drifts snow across roads and closes exposed routes.' },
  ice: { label: 'Ice risk', unit: 'per step (low, medium, high)', meaning: 'Freezing rain and refreeze make roads and paths unsafe.' },
  elevation: { label: 'Elevation', unit: 'per 100 m', meaning: 'Higher sites get more snow and are ploughed last.' },
  exposure: { label: 'Exposure', unit: 'per step (sheltered, normal, exposed)', meaning: 'Exposed sites drift over and lose power more often.' },
  road: { label: 'Road', unit: 'per step (main, secondary, rural)', meaning: 'Minor roads are gritted and ploughed later.' },
};

/**
 * The hand-set prior: used outright while there are fewer than `rules.minHistory` past decisions, and the centre the
 * fit is pulled toward afterwards. Read it as log-odds: +0.22 per cm means every 10 cm of forecast snow multiplies the
 * odds of a closure by e^2.2 ≈ 9.
 */
export const PRIOR: { intercept: number; coef: Record<Feature, number> } = {
  intercept: -4.2,
  coef: { snow: 0.22, cold: 0.1, wind: 0.03, ice: 0.9, elevation: 0.1, exposure: 0.35, road: 0.45 },
};

/** Demo regions, in the order the globe lays them out (back, left, front right). */
export const REGION_ORDER = ['Ridge', 'Valley', 'Lakeshore'] as const;
