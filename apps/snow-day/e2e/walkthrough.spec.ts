/** Dry run of demo/walkthrough.ts: every step's locator must resolve (no narration, no recording). */
import { test, type Locator } from '@playwright/test';

import type { DemoHelpers } from '@x10/shared/demo';

import { script } from '../demo/walkthrough';

test('the demo walkthrough runs end to end', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'Recorded at 1920x1080.');
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const loc = (t: Locator | string) => (typeof t === 'string' ? page.getByText(t).first() : t);
  let first = true;
  const h: DemoHelpers = {
    page,
    async goto(path, persona) {
      const p = persona ?? script.persona;
      await page.goto(first ? `/?as=${p}#${path}` : `/#${path}`);
      first = false;
    },
    click: async (t) => loc(t).click(),
    type: async (t, text) => loc(t).fill(text),
    fill: async (t, text) => loc(t).fill(text),
    select: async (t, label) => {
      await loc(t).selectOption({ label });
    },
    hover: async (t) => loc(t).hover(),
    scrollTo: async (t) => loc(t).scrollIntoViewIfNeeded(),
    spotlight: async (t) => loc(t).waitFor(),
    pause: async (ms) => page.waitForTimeout(Math.min(ms, 300)),
  };
  for (const scene of script.scenes) await test.step(scene.id, () => scene.run(h));
});
