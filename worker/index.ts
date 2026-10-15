/**
 * Worker entry: HTTP goes to vinext (pages + /api via Hono); the cron trigger
 * (21:00 IST, see wrangler.jsonc) runs the daily summary / reminders / housekeeping job.
 */
import handler from "vinext/server/fetch-handler";
import { getDb } from "../src/server/db/client";
import { createLogger } from "../src/server/lib/logger";
import { runDailyJobs } from "../src/server/services/notifications";

export default {
  ...handler,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const logger = createLogger({ service: "suvakta", job: "cron", cron: controller.cron });
    ctx.waitUntil(
      runDailyJobs(getDb(env.DB), env, controller.scheduledTime, logger).catch((err: unknown) => {
        logger.error("cron failed", { error: String(err) });
      }),
    );
  },
};
