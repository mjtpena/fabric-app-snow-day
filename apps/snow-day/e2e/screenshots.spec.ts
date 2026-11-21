/**
 * Redesign screenshots (not a test). Run: SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
 * Writes docs/redesign/<screen>-<theme>-<desktop|phone>.png. ONLY=<name,name> limits it.
 */
import { expect, test, type Page } from '@playwright/test';

import { openApp } from '@x10/shared/e2e';

import { clickToday, globeReady, KAI, ROBIN } from './helpers';

type Shot = { name: string; path: string; persona: string; full?: boolean; act?: (page: Page, phone: boolean) => Promise<void> };

const lens = (name: RegExp) => async (page: Page) => {
  await globeReady(page);
  await page.getByRole('radiogroup', { name: 'Lens' }).getByRole('radio', { name }).click();
};

const SHOTS: Shot[] = [
  { name: 'globe-probability', path: '/', persona: ROBIN, act: async (page) => globeReady(page) },
  {
    name: 'globe-storm-snow',
    path: '/',
    persona: ROBIN,
    act: async (page) => {
      await lens(/Snow/)(page);
      await page.getByRole('radiogroup', { name: 'Day' }).getByRole('radio').nth(1).click();
      await page.waitForTimeout(2500);
    },
  },
  { name: 'globe-decision', path: '/', persona: ROBIN, act: lens(/Decision/) },
  {
    name: 'globe-today-focus',
    path: '/',
    persona: ROBIN,
    act: async (page) => {
      await globeReady(page);
      await clickToday(page, /Harbour Lane School: called closed/);
      await page.waitForTimeout(1600);
    },
  },
  { name: 'globe-lead-view', path: '/', persona: KAI, act: async (page) => globeReady(page) },
  {
    name: 'globe-nowebgl',
    path: '/',
    persona: ROBIN,
    act: async (page) => {
      await page.goto(`/?nowebgl&as=${ROBIN}#/`);
      await expect(page.getByTestId('globe-svg')).toBeVisible();
    },
  },
  { name: 'globe-list', path: '/', persona: ROBIN, full: true, act: async (page) => page.getByRole('radio', { name: 'List' }).click() },
  { name: 'call', path: '/call', persona: ROBIN, full: true },
  {
    name: 'call-against',
    path: '/call',
    persona: ROBIN,
    act: async (page) => {
      await page.getByTestId('call-row').filter({ hasText: 'Ridge Road Clinic' }).click();
      const panel = page.getByTestId('call-panel');
      await panel.getByRole('radiogroup', { name: 'Call' }).getByRole('radio', { name: /^Open/ }).click();
      await panel.getByLabel('Reason').fill('Road gritted');
      await panel.getByRole('button', { name: 'Make the call' }).click();
    },
  },
  {
    name: 'call-revision',
    path: '/call',
    persona: ROBIN,
    act: async (page) => {
      await page.getByRole('radiogroup', { name: 'Day' }).getByRole('radio').first().click();
      await page.getByTestId('call-row').filter({ hasText: 'Summit Primary' }).click();
    },
  },
  { name: 'station', path: '/station', persona: KAI, full: true },
  {
    name: 'station-log',
    path: '/station',
    persona: KAI,
    act: async (page) => page.getByRole('button', { name: 'Log forecast' }).first().click(),
  },
  {
    name: 'station-import',
    path: '/station?tab=import',
    persona: ROBIN,
    act: async (page) => {
      const day = await page.getByTestId('import-day-hint').getAttribute('data-day');
      await page
        .getByLabel('Paste the CSV')
        .fill(`site,day,snow_cm,temp_min_c,wind_kmh,ice_risk,source\nPine Hollow Depot,${day},10.5,-6,35,medium,Road weather station\nSummit Primary,${day},13,-7,46,high,Road weather station\nNowhere School,${day},1,0,5,low,Met service\nValley Depot,${day},lots,0,5,low,Met service`);
    },
  },
  { name: 'station-sites', path: '/station?tab=sites', persona: ROBIN, full: true },
  { name: 'logbook', path: '/logbook', persona: KAI, full: true },
  { name: 'hindsight', path: '/hindsight', persona: ROBIN, full: true },
  { name: 'about', path: '/about', persona: ROBIN, full: true },
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    for (const s of SHOTS) {
      test(`${s.name} ${scheme}`, async ({ page }, info) => {
        test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to write the redesign screenshots.');
        test.skip(!!process.env.ONLY && !process.env.ONLY.split(',').includes(s.name), 'Not selected');
        test.setTimeout(90_000);
        const phone = info.project.name === 'phone';
        if (!phone) await page.setViewportSize({ width: 1280, height: 800 });
        await openApp(page, s.path, s.persona);
        await page.getByTestId('demo-banner').getByRole('button').first().click().catch(() => undefined);
        if (s.act) await s.act(page, phone);
        await page.waitForTimeout(2400);
        await page.screenshot({ path: `docs/redesign/${s.name}-${scheme}-${phone ? 'phone' : 'desktop'}.png`, fullPage: !!s.full && !phone });
      });
    }
  });
}
