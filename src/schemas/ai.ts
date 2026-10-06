import { z } from "zod";

export const interpretSchema = z.object({
  text: z.string().trim().min(1, "Say or type something").max(500),
  /** When the text came from the browser's speech recognition. */
  voice: z
    .object({ provider: z.enum(["browser"]), language: z.string().max(10).optional(), durationMs: z.number().int().min(0).max(120_000).optional() })
    .optional(),
});

export const clarifySchema = z
  .object({ optionId: z.string().max(64).optional(), text: z.string().trim().max(40).optional() })
  .refine((v) => v.optionId || v.text, "Choose an option");
