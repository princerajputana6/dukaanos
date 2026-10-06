import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const alias = { "@": path.resolve(import.meta.dirname, "src") };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        plugins: [
          cloudflareTest(async () => {
            const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
            return {
              miniflare: {
                compatibilityDate: "2026-08-20",
                compatibilityFlags: ["nodejs_compat"],
                d1Databases: ["DB"],
                r2Buckets: ["FILES"],
                bindings: {
                  ENVIRONMENT: "test",
                  APP_URL: "http://localhost",
                  FLAG_VOICE_ENABLED: "true",
                  FLAG_AI_INSIGHTS_ENABLED: "true",
                  FLAG_OFFLINE_ENABLED: "true",
                  FLAG_GST_ENABLED: "true",
                  FLAG_REPORTS_ENABLED: "true",
                  TEST_MIGRATIONS: migrations,
                },
              },
            };
          }),
        ],
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/integration/setup.ts"],
        },
      },
    ],
  },
});
