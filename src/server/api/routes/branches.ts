import { createBranchSchema } from "@/schemas/platform";
import * as branches from "@/server/services/branches";
import { body, ok } from "../respond";
import { bizRouter, requirePerm } from "../middleware";

/** Owner: branches of the current account (tenant). */
export const branchRoutes = bizRouter()
  .get("/", async (c) => ok(c, await branches.listBranches(c.get("ctx"))))
  .post("/", requirePerm("settings.manage"), async (c) => ok(c, await branches.createBranch(c.get("ctx"), await body(c, createBranchSchema)), 201));
