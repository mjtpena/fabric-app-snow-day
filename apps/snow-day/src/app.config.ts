/**
 * App configuration. No React imports here: tools/seed-fabric.mjs loads this file in Node to export seed rows.
 */
import type { Persona } from '@x10/shared/identity';
import type { AppConfig } from '@x10/shared/runtime';

import { defs, type Schema } from './model';
import { seed } from './seed';

/**
 * Demo personas. Order matters to the seed: 0 the duty manager (admin, the default, makes the calls), 1–3 site leads
 * for the Ridge, Valley and Lakeshore sites (enter forecasts and outcomes for their own sites).
 */
export const personas: Persona[] = [
  { sub: 'demo-duty-robin', name: 'Robin Ellis', email: 'robin@example.com', isAdmin: true, role: 'Duty manager' },
  { sub: 'demo-lead-kai', name: 'Kai Lindqvist', email: 'kai@example.com', isAdmin: false, role: 'Site lead (Ridge)' },
  { sub: 'demo-lead-amara', name: 'Amara Osei', email: 'amara@example.com', isAdmin: false, role: 'Site lead (Valley)' },
  { sub: 'demo-lead-tomas', name: 'Tomás Reyes', email: 'tomas@example.com', isAdmin: false, role: 'Site lead (Lakeshore)' },
];

export const config: AppConfig<Schema> = {
  appId: 'snow-day',
  title: 'Snow Day',
  tagline: 'Snow closure calls from the forecast, with a record',
  defs,
  personas,
  seed,
  accent: 'ice',
  // A snow globe: the glass, a roofline inside it and the turned base.
  logoPaths: ['M12 3a7 7 0 0 0-5 11.9', 'M12 3a7 7 0 0 1 5 11.9', 'M9 14v-2.5l3-2.5 3 2.5V14', 'M6 18.5h12', 'M7.5 21h9l-1.5-2.5h-6z'],
  nav: [
    { to: '/', label: 'Globe', end: true },
    { to: '/call', label: 'The call' },
    { to: '/station', label: 'Weather station' },
    { to: '/logbook', label: 'Logbook' },
    { to: '/hindsight', label: 'Hindsight' },
    { to: '/about', label: 'About' },
  ],
};
