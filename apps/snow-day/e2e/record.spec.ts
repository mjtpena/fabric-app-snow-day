import { expect, test } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

import { KAI, ROBIN } from './helpers';

test('weather station: a CSV import previews every row and imports the good ones', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/station?tab=import', ROBIN);
  await page.getByLabel('Paste the CSV').fill(['site,day,snow_cm,temp_min_c,wind_kmh,ice_risk,source', 'Pine Hollow Depot,2099-01-01,10,-6,35,medium,Road weather station', 'Nowhere School,2026-01-01,1,0,5,low,Met service'].join('\n'));
  const rows = page.getByTestId('import-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-ok', 'false');
  await expect(rows.nth(0)).toContainText('at most 14 days ahead');
  await expect(rows.nth(1)).toContainText('No site called');
  await expect(page.getByRole('button', { name: /Import 0 rows/ })).toBeDisabled();
  // The first day of the outlook, from the page itself.
  const day = await page.getByTestId('import-day-hint').getAttribute('data-day');
  await page.getByLabel('Paste the CSV').fill(`site,day,snow_cm,temp_min_c,wind_kmh,ice_risk,source\nPine Hollow Depot,${day},10.5,-6,35,medium,Road weather station\nNowhere School,${day},1,0,5,low,Met`);
  await page.getByRole('button', { name: 'Import 1 row' }).click();
  await expect(page.getByText(/Imported 1 forecast; 1 row skipped/)).toBeVisible();
  await page.getByRole('tab', { name: 'Outlook' }).click();
  await expect(page.getByTestId('outlook-row').filter({ hasText: 'Pine Hollow Depot' })).toContainText('10.5');
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('logbook: a site lead records what the day brought and the verdict appears', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/logbook', KAI);
  const entry = page.getByTestId('logbook-entry').filter({ hasText: 'Revised: the bus operator' });
  await entry.getByRole('button', { name: 'Record outcome' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Snow on the ground (cm)').fill('6');
  await dialog.getByLabel('Incidents').fill('1');
  await dialog.getByRole('button', { name: 'Record outcome' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(entry.getByTestId('outcome')).toContainText('6 cm');
  await expect(entry.getByTestId('verdict')).toHaveAttribute('data-verdict', 'hit');
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('hindsight shows the hit rate, over-cautious calls and the calibration', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/hindsight', ROBIN);
  await expect(page.getByTestId('hit-rate')).toHaveText(/\d+%/);
  await expect(page.getByTestId('over-cautious')).not.toHaveText('0');
  await expect(page.getByTestId('calibration')).toBeVisible();
  await expect(page.getByTestId('coefficients')).toContainText('Snow');
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('about lists the rules with their thresholds and the live coefficients', async ({ page }) => {
  await openApp(page, '/about', ROBIN);
  const rules = page.getByTestId('rules');
  await expect(rules).toContainText('0.35');
  await expect(rules).toContainText('09:00');
  await expect(rules).toContainText('15');
  await expect(page.getByTestId('coefficients')).toContainText('Ice risk');
  await assertNoHorizontalScroll(page);
});
