import { AppMarker } from './AppMarker.js';
import { Decision } from './Decision.js';
import { Forecast } from './Forecast.js';
import { Outcome } from './Outcome.js';
import { Person } from './Person.js';
import { Site } from './Site.js';

export type AppSchema = {
  Person: Person;
  AppMarker: AppMarker;
  Site: Site;
  Forecast: Forecast;
  Decision: Decision;
  Outcome: Outcome;
};

export const schema = [Person, AppMarker, Site, Forecast, Decision, Outcome];
