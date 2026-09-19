import * as z from "zod/v4";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants.js";

export const responseFormatSchema = z.enum(["markdown", "json"])
  .default("markdown")
  .describe("Formát odpovědi: markdown pro člověka, json pro další zpracování.");

export const pageFields = {
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
    .describe(`Maximální počet položek v odpovědi (1-${MAX_PAGE_SIZE}).`),
  offset: z.number().int().min(0).default(0)
    .describe("Počet položek přeskočených od začátku výsledků."),
  response_format: responseFormatSchema,
} as const;

export const uuidSchema = z.uuid().describe("UUID záznamu v EKV Portálu.");

export const optionalSearchSchema = z.string().trim().min(2).max(100).optional()
  .describe("Volitelný textový filtr o délce 2 až 100 znaků.");
