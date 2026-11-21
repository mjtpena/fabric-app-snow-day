import { expect, test } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

import { clickToday, globeReady, globeStage, KAI, ROBIN } from './helpers';

test('the snow globe renders every site, and a lens re-paints it', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/', ROBIN);
  await globeReady(page);
  await expect(page.getByTestId('globe-site')).toHaveCount(10);
  await expect(page.getByRole('button', { name: /^Summit Primary, 12 cm forecast, \d+% closure, called closed/ })).toHaveCount(1);
  await page.getByRole('radiogroup', { name: 'Lens' }).getByRole('radio', { name: /Snow/ }).click();
  await expect(page.locator('[data-testid="globe-site"][aria-label^="Summit Primary"]')).toContainText('12 cm');
  await page.getByRole('radiogroup', { name: 'Lens' }).getByRole('radio', { name: /Decision/ }).click();
  await expect(page.locator('[data-testid="globe-site"][aria-label^="Harbour Lane School"]')).toContainText('Closed');
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('a Today item focuses the site behind it', async ({ page }) => {
  await openApp(page, '/', ROBIN);
  await globeReady(page);
  await clickToday(page, /Harbour Lane School: called closed/);
  const card = page.getByTestId('site-card');
  await expect(card).toHaveAttribute('data-site', 'Harbour Lane School');
  await expect(card.getByTestId('site-card-reason')).toContainText('Against the model');
  await expect(page.getByRole('radiogroup', { name: 'Lens' }).getByRole('radio', { name: /Disagreement/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page).toHaveURL(/site=/);
});

test('AC4: the snowfall follows the selected day, and the list view agrees', async ({ page }) => {
  await openApp(page, '/', ROBIN);
  await globeReady(page);
  const stage = globeStage(page);
  const dial = page.getByRole('radiogroup', { name: 'Day' });
  await expect(stage).toHaveAttribute('data-snow-cm', /\d/);
  const todaySnow = Number(await stage.getAttribute('data-snow-cm'));
  const todayFlakes = Number(await stage.getAttribute('data-flakes'));
  // Day 2: the storm.
  await dial.getByRole('radio').nth(1).click();
  await expect.poll(async () => Number(await stage.getAttribute('data-snow-cm'))).toBeGreaterThan(todaySnow + 8);
  const stormSnow = await stage.getAttribute('data-snow-cm');
  expect(Number(await stage.getAttribute('data-flakes'))).toBeGreaterThan(todayFlakes);
  await expect(page.locator('[data-testid="globe-site"][aria-label^="Summit Primary"]')).toHaveAttribute('aria-label', /34 cm forecast/);
  // Day 5: dry, no snow falls.
  await dial.getByRole('radio').nth(4).click();
  await expect(stage).toHaveAttribute('data-snow-cm', '0.0');
  await expect(stage).toHaveAttribute('data-flakes', '0');
  // The list view shows the same day and the same numbers.
  await dial.getByRole('radio').nth(1).click();
  await expect(stage).toHaveAttribute('data-snow-cm', stormSnow!);
  await page.getByRole('radio', { name: 'List' }).click();
  const list = page.getByTestId('globe-list');
  await expect(list).toHaveAttribute('data-snow-cm', stormSnow!);
  await expect(page.getByTestId('list-mean-snow')).toContainText(`${Number(stormSnow)} cm`);
  await expect(list.getByTestId('list-row').filter({ hasText: 'Summit Primary' }).getByTestId('list-snow')).toHaveText('34');
  await expect(list.getByTestId('list-row')).toHaveCount(10);
});

test('the list view holds the same decisions as the globe', async ({ page }) => {
  await openApp(page, '/', ROBIN);
  await page.getByRole('radio', { name: 'List' }).click();
  const rows = page.getByTestId('list-row');
  await expect(rows).toHaveCount(10);
  await expect(rows.filter({ hasText: 'Summit Primary' })).toContainText('Closed');
  await expect(rows.filter({ hasText: 'Harbour Lane School' })).toContainText('Against the model');
  await expect(rows.filter({ hasText: 'Pine Hollow Depot' }).getByTestId('list-snow')).toHaveText('none');
  await assertNoHorizontalScroll(page);
});

test('AC5: ?nowebgl shows the SVG site map with the same encodings', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await page.goto(`/?nowebgl&as=${ROBIN}#/`);
  await expect(page.getByTestId('globe-svg')).toBeVisible();
  await expect(page.getByTestId('nowebgl-note')).toBeVisible();
  await expect(page.getByTestId('globe-canvas')).toHaveCount(0);
  await expect(page.getByTestId('globe-site')).toHaveCount(10);
  const svg = page.getByTestId('globe-svg');
  const before = Number(await svg.getAttribute('data-snow-cm'));
  await page.getByRole('radiogroup', { name: 'Day' }).getByRole('radio').nth(1).click();
  await expect.poll(async () => Number(await svg.getAttribute('data-snow-cm'))).toBeGreaterThan(before);
  await page.getByRole('button', { name: /^Summit Primary,/ }).click();
  await expect(page.getByTestId('site-card')).toHaveAttribute('data-site', 'Summit Primary');
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('view as site lead narrows Today to the lead’s own sites', async ({ page }) => {
  await openApp(page, '/', KAI);
  await globeReady(page);
  await expect(page.getByRole('radiogroup', { name: 'View as' }).getByRole('radio', { name: 'Lead' })).toHaveAttribute('aria-checked', 'true');
  await clickToday(page, /Pine Hollow Depot has no forecast/);
  await expect(page.getByTestId('site-card')).toHaveAttribute('data-site', 'Pine Hollow Depot');
  await expect(page.getByTestId('site-card').getByRole('link', { name: 'Log forecast' })).toBeVisible();
  await expect(page.getByTestId('site-card').getByRole('link', { name: /call/ })).toHaveCount(0);
});
