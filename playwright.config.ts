import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the judge journey.
 *
 * These are not unit tests and they are not a coverage exercise. They walk the
 * path a judge actually takes through the deployed product, against the real
 * Creditcoin deployment, and they are allowed to be slow because the thing being
 * tested is slow: a clearance check locates a transaction on Ethereum, fetches a
 * proof and has a precompile rule on it.
 *
 * TWO RULES, BOTH DELIBERATE
 *
 * 1. Nothing is mocked. If the chain, the prover or the site is unreachable the
 *    suite fails, and that is the correct outcome. A green run against mocks
 *    would tell us nothing about whether a judge can use the product.
 *
 * 2. Nothing skips silently. A test that cannot run is a failure, not a pass.
 *    Where live state is genuinely optional, the assertion is written against
 *    the honest degraded state rather than being conditionally skipped.
 *
 * Uses the system Chrome rather than a downloaded browser: it is already present
 * on the machines this runs on, and it is closer to what a judge will use.
 */
export default defineConfig({
  testDir: './e2e',
  // The full clearance pipeline is a real cross-chain round trip.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm --prefix frontend run start -- -p 3000',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
