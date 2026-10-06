import { defineConfig, devices } from "@playwright/test";

const PORT = 8790;
export const BASE_URL = `http://localhost:${PORT}`;

/**
 * E2E runs against the PRODUCTION build served by wrangler (real Worker + local D1),
 * on a dedicated database under .wrangler/e2e-state that is reset each run.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-IN", timezoneId: "Asia/Kolkata" },
  globalSetup: "./tests/e2e/global-setup.ts",
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], storageState: "tests/e2e/.auth/owner.json" }, testIgnore: /auth\.spec|mobile\.spec/ },
    { name: "mobile", use: { ...devices["Pixel 7"], storageState: "tests/e2e/.auth/owner.json" }, testMatch: /mobile\.spec/ },
    { name: "auth", use: { ...devices["Desktop Chrome"] }, testMatch: /auth\.spec/ },
  ],
  webServer: {
    command: `rm -rf .wrangler/e2e-state && npx wrangler d1 migrations apply dukaanos-dev --local --persist-to .wrangler/e2e-state --config wrangler.jsonc && npx wrangler dev --config dist/server/wrangler.json --port ${PORT} --persist-to .wrangler/e2e-state`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { CI: "1" },
  },
});
