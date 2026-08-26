import { test, expect } from '@playwright/test';

/**
 * Mobile navigation and layout.
 *
 * The box-model audit in `scripts/_mobile_audit.mjs` already proves no route
 * scrolls horizontally. What it cannot prove is that the navigation is reachable
 * and that the primary surfaces are usable with a thumb, which is what this
 * covers. Runs only in the mobile project.
 */

const ROUTES = ['/', '/book', '/registry', '/clearance', '/challenge', '/verify', '/docs'];

test.describe('mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile project only');

  test('every primary route is reachable from the nav', async ({ page }) => {
    await page.goto('/');

    // Chrome renders the nav twice, one copy per breakpoint, with the inactive
    // one display:none. Selecting the first in DOM order picks the desktop copy
    // and fails on a phone for the wrong reason, so match the visible one.
    for (const href of ROUTES.slice(1)) {
      const link = page.locator(`nav a[href="${href}"]:visible`).first();
      await expect(link, `visible nav link for ${href}`).toBeVisible();
    }
  });

  test('no route scrolls horizontally', async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      // Settle async chain reads that can widen a table after first paint.
      await page.waitForTimeout(1500);
      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
      });
      expect(
        overflow.scrollWidth,
        `${route} overflows: ${overflow.scrollWidth} > ${overflow.clientWidth}`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  });

  test('the two gaps are legible on a phone', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /proof is not enough/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Omission$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Reuse$/ })).toBeVisible();
  });

  test('clearance input and examples are usable', async ({ page }) => {
    await page.goto('/clearance');
    await expect(page.getByLabel(/transaction hash/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /A disbursement on this book/i })).toBeVisible();
  });
});
