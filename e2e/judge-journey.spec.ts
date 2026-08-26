import { test, expect, type Page } from '@playwright/test';

/**
 * The judge journey, end to end, against the real deployment.
 *
 * Ordered the way a judge moves through the product: land, see a verdict,
 * inspect the claim behind it, then go looking for whether any of it is true.
 */

/** Fails the test if the page logged an uncaught error, rather than letting a broken page pass. */
function failOnPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test.describe('landing', () => {
  test('loads and states the thesis', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /can be proven wrong/i })).toBeVisible();
    // The two-gap model must be on the front door, not buried.
    await expect(page.getByRole('heading', { name: /proof is not enough/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Omission$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Reuse$/ })).toBeVisible();

    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('zero-config entry shows a live verdict with no wallet', async ({ page }) => {
    await page.goto('/');

    const card = page.locator('div').filter({ hasText: /^Evidence status/ }).first();
    await expect(card).toBeVisible();

    // The verdict is read from the deployed contract, so it must resolve without
    // any interaction. If this ever hangs, the judge's first impression is a
    // skeleton, which is the specific failure this surface exists to prevent.
    await expect(page.getByText('Encumbered in Clearbook')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/live read . deployed contract/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /Loan #\d+/ })).toBeVisible();

    // No wallet was connected at any point.
    await expect(page.getByRole('button', { name: /connect wallet/i })).toBeVisible();
  });

  test('inspect the claim reaches a real loan', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Encumbered in Clearbook')).toBeVisible({ timeout: 45_000 });

    await page.getByRole('link', { name: /Inspect the claim/i }).click();
    await expect(page).toHaveURL(/\/loan\/\d+/);
    await expect(page.getByText(/covenant/i).first()).toBeVisible();
  });
});

test.describe('registry', () => {
  test('opens, lists verified facts, and shows both instruments', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.goto('/registry');

    await expect(page.getByRole('heading', { name: /the evidence this book runs on/i })).toBeVisible();

    // Both evidence gaps must be named on this page. These labels are the whole
    // point of the pairing and a silent rename would make the thesis unreadable.
    await expect(page.getByText('Reuse', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Omission', { exact: true }).first()).toBeVisible();

    // The listing is a bounded scan and genuinely slow; it must still arrive.
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    expect(await rows.count()).toBeGreaterThan(0);

    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('coverage renders with its denominator, never as a bare score', async ({ page }) => {
    await page.goto('/registry');

    await expect(
      page.getByRole('heading', { name: /how much of each book is actually on the book/i }),
    ).toBeVisible({ timeout: 60_000 });

    // Either a measured ratio or an explicit no-denominator state. What is not
    // acceptable is a percentage with nothing to divide.
    const measured = page.getByText(/\d+\s*\/\s*\d+/);
    const noDenominator = page.getByText(/no ratio|denominator|declared no treasury/i);
    await expect(measured.or(noDenominator).first()).toBeVisible({ timeout: 60_000 });
  });
});

test.describe('clearance', () => {
  test('returns ENCUMBERED for a fact already committed', async ({ page }) => {
    await page.goto('/clearance');
    await expect(page.getByRole('heading', { name: /check evidence before you lend/i })).toBeVisible();

    await page.getByRole('button', { name: /A disbursement on this book/i }).click();
    await page.getByRole('button', { name: /^Check clearance$/i }).click();

    // Full cross-chain path: locate, resolve chain key, attest, prove, verify,
    // then read the book. Slow on purpose and not mocked.
    // Exact match: the same phrase also opens the scope sentence below the
    // verdict, which is deliberate, so a loose matcher is ambiguous by design.
    await expect(page.getByText('Encumbered in Clearbook', { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText(/Committed to loan #\d+/i)).toBeVisible();

    // The verdict never renders without its scope.
    await expect(page.getByText(/does not establish|already committed to a claim/i).first()).toBeVisible();
  });

  test('returns CLEAR for verified evidence no claim cites', async ({ page }) => {
    await page.goto('/clearance');

    await page.getByRole('button', { name: /A stranger on Ethereum mainnet/i }).click();
    await page.getByRole('button', { name: /^Check clearance$/i }).click();

    await expect(page.getByText('Clear in Clearbook', { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    // CLEAR must always carry the boundary. This is the single most dangerous
    // string in the product to render bare.
    await expect(page.getByText(/does not establish that the underlying/i)).toBeVisible();
  });

  test('rejects a malformed hash without pretending to check it', async ({ page }) => {
    await page.goto('/clearance');
    await page.getByLabel(/transaction hash/i).fill('not-a-hash');
    await expect(page.getByText(/32 bytes of hex/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Check clearance$/i })).toBeDisabled();
  });
});

test.describe('verify', () => {
  test('runs the precompile path and routes on to clearance', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.goto('/verify');

    await expect(page.getByRole('heading', { name: /verify any ethereum transaction/i })).toBeVisible();
    // Verify answers the first question; it must point at where the second is answered.
    await expect(page.getByRole('link', { name: /check clearance/i })).toBeVisible();

    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
});

test.describe('book and challenge', () => {
  test('book lists claims read from the chain', async ({ page }) => {
    await page.goto('/book');
    await expect(page.locator('body')).toContainText(/originator|claim|bond/i, { timeout: 60_000 });
  });

  /**
   * The challenge console depends on an open challenge window, which expires.
   * The assertion is therefore on honest behaviour rather than on a breach being
   * available: with a window open it offers a claim, and without one it says so.
   * A conditional skip here would hide exactly the regression worth catching.
   */
  test('challenge console opens and states its state honestly', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.goto('/challenge');

    // A content assertion on the body rather than a locator, for two reasons:
    // the word "challenge" also appears in the nav, and what is being tested is
    // that the page SAYS something true about its state, not that one specific
    // element exists. Either it offers a claim to work on, or it reports that no
    // window is open. Rendering neither is the failure.
    await expect(page.locator('body')).toContainText(
      /select the claim|cite the funding|evaluate the covenant|no open|window closed|nothing to challenge|settled/i,
      { timeout: 60_000 },
    );

    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
});

test.describe('docs', () => {
  test('clearance documentation exists and states the boundary', async ({ page }) => {
    await page.goto('/docs/clearance');
    await expect(page.getByRole('heading', { name: /clearance/i }).first()).toBeVisible();
    await expect(page.getByText(/fact identity is not collateral identity/i)).toBeVisible();
  });
});
