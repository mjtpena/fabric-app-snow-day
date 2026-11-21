import { expect, test, type Page } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

import { KAI, ROBIN } from './helpers';

async function openSite(page: Page, name: string) {
  await page.getByTestId('call-row').filter({ hasText: name }).click();
  await expect(page.getByTestId('call-panel')).toHaveAttribute('data-site', name);
  return page.getByTestId('call-panel');
}

test('AC2: calling against the model by more than the gap requires a 30+ character reason', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/call', ROBIN);
  const panel = await openSite(page, 'Ridge Road Clinic');
  const call = panel.getByRole('radiogroup', { name: 'Call' });
  await expect(call.getByRole('radio', { name: /^Open/ })).toContainText('Against the model');
  await call.getByRole('radio', { name: /^Open/ }).click();
  await expect(panel.getByText(/Against the model by \d+ points/)).toBeVisible();
  await panel.getByLabel('Reason').fill('Road gritted');
  await panel.getByRole('button', { name: 'Make the call' }).click();
  await expect(panel.getByRole('alert')).toContainText(/against the model by \d+ points\. Give a reason of at least 30 characters/);
  await expect(panel.getByTestId('call-history')).toHaveCount(0);
  await panel.getByLabel('Reason').fill('Clinic road is on the hospital gritting route and was cleared at 04:00.');
  await panel.getByRole('button', { name: 'Make the call' }).click();
  await expect(panel.getByTestId('call-history').getByTestId('history-item')).toHaveCount(1);
  await expect(panel.getByTestId('current-reason')).toContainText('hospital gritting route');
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('a call with the model takes a short reason', async ({ page }) => {
  await openApp(page, '/call', ROBIN);
  const panel = await openSite(page, 'Upper Fells School');
  await panel.getByRole('radiogroup', { name: 'Call' }).getByRole('radio', { name: /^Closed/ }).click();
  await panel.getByLabel('Reason').fill('Fells road drifting');
  await panel.getByRole('button', { name: 'Make the call' }).click();
  await expect(panel.getByTestId('call-history').getByTestId('history-item')).toHaveCount(1);
});

test('AC3: after 09:00 a change creates a revised decision instead of editing', async ({ page }) => {
  await openApp(page, '/call', ROBIN);
  // The first day on the strip is always past its 09:00 lock.
  await page.getByRole('radiogroup', { name: 'Day' }).getByRole('radio').first().click();
  const panel = await openSite(page, 'Harbour Lane School');
  await expect(panel.getByTestId('lock-state')).toHaveText('Locked at 09:00');
  await expect(panel.getByText('Calls for this day are locked')).toBeVisible();
  await panel.getByRole('radiogroup', { name: 'Call' }).getByRole('radio', { name: /^Closed/ }).click();
  await panel.getByLabel('Reason').fill('Ice on the paths');
  await panel.getByRole('button', { name: 'Record revision' }).click();
  await expect(panel.getByRole('alert')).toContainText('so this is a revision');
  await panel.getByLabel('Reason').fill('Burst pipe in the main hall at 10:15; pupils sent home.');
  await panel.getByRole('button', { name: 'Record revision' }).click();
  const history = panel.getByTestId('call-history').getByTestId('history-item');
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText('Revised: Burst pipe in the main hall');
  await expect(history.first()).toContainText('in force');
  await expect(history.nth(1)).toContainText('replaced');
  await expect(history.nth(1)).toContainText('Open');
});

test('site leads read the call but cannot make it', async ({ page }) => {
  await openApp(page, '/call', KAI);
  const panel = await openSite(page, 'Summit Primary');
  await expect(panel.getByText('Only the duty manager makes the call')).toBeVisible();
  await expect(panel.getByRole('radiogroup', { name: 'Call' })).toHaveCount(0);
});
