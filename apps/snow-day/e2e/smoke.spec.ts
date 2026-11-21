import { expect, test } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

import { KAI } from './helpers';

test('loads, logs a forecast, sees it in the outlook, no console errors', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/station', KAI);
  await expect(page.getByRole('heading', { name: 'Weather station' })).toBeVisible();
  const row = page.getByTestId('outlook-row').filter({ hasText: 'Pine Hollow Depot' });
  await expect(row).toContainText('No forecast');
  await page.getByRole('button', { name: 'Log forecast' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Site')).toHaveValue(/.+/);
  await dialog.getByLabel('Snow (cm)').fill('9.5');
  await dialog.getByLabel('Minimum temperature (°C)').fill('-6');
  await dialog.getByLabel('Wind (km/h)').fill('35');
  await dialog.getByRole('radio', { name: 'Medium' }).click();
  await dialog.getByLabel('Source').fill('Road weather station');
  await dialog.getByRole('button', { name: 'Log forecast' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row.getByRole('button').first()).toContainText('9.5');
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('a site lead cannot log forecasts for other sites', async ({ page }) => {
  await openApp(page, '/station', KAI);
  const valley = page.getByTestId('outlook-row').filter({ hasText: 'Valley Depot' });
  await expect(valley.getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Log forecast' }).first().click();
  await expect(page.getByRole('dialog').getByLabel('Site').locator('option')).toHaveText(['Pine Hollow Depot', 'Ridge Road Clinic', 'Summit Primary', 'Upper Fells School']);
});
