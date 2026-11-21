import { expect, type Page } from '@playwright/test';

export const ROBIN = 'demo-duty-robin';
export const KAI = 'demo-lead-kai';
export const AMARA = 'demo-lead-amara';

/** Wait for the centrepiece (three.js ready, or the SVG fallback). */
export async function globeReady(page: Page) {
  await expect(page.locator('[data-testid="globe-canvas"][data-ready="true"], [data-testid="globe-svg"]').first()).toBeVisible({ timeout: 30_000 });
}

export function isPhone(page: Page) {
  return (page.viewportSize()?.width ?? 1280) < 768;
}

/** Click a Today item (on phones, open the Today sheet first). */
export async function clickToday(page: Page, name: RegExp) {
  if (isPhone(page)) await page.getByRole('button', { name: /^Today/ }).click();
  await page.getByRole('button', { name }).click();
}

export const globeStage = (page: Page) => page.locator('[data-testid="globe-canvas"], [data-testid="globe-svg"]').first();
