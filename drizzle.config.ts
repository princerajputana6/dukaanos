import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./migrations",
  // D1 migrations are applied with `wrangler d1 migrations apply` (see package.json).
});
