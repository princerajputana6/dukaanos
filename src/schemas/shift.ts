import { z } from "zod";
import { optionalText, paiseSchema } from "./common";

export const openShiftSchema = z.object({ openingCashPaise: paiseSchema.default(0) });
export const closeShiftSchema = z.object({ countedCashPaise: paiseSchema, note: optionalText(300) });
