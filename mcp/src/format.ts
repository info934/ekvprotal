import { DEFAULT_CHARACTER_LIMIT } from "./constants.js";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ResponseFormat } from "./constants.js";
import type { Row } from "./types.js";

function configuredCharacterLimit(): number {
  const raw = process.env.EKV_PORTAL_MAX_RESPONSE_CHARS?.trim();
  const value = raw ? Number(raw) : DEFAULT_CHARACTER_LIMIT;
  return Number.isInteger(value) && value >= 1_000 ? value : DEFAULT_CHARACTER_LIMIT;
}

export function truncateResponse(text: string): string {
  const limit = configuredCharacterLimit();
  if (text.length <= limit) return text;
  const notice = "\n\n_Odpověď byla zkrácena. Použijte přesnější filtr, menší `limit` nebo další `offset`._";
  return `${text.slice(0, Math.max(0, limit - notice.length))}${notice}`;
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text: truncateResponse(text) }] };
}

export function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : "Nastala neočekávaná chyba.";
  return { isError: true, content: [{ type: "text", text: `Chyba: ${message}` }] };
}

export function stringValue(row: Row, key: string, fallback = "—"): string {
  const value = row[key];
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

export function formatPagedRows(input: {
  title: string;
  itemLabel: string;
  rows: Row[];
  total: number | null;
  offset: number;
  format: ResponseFormat;
  markdownRow: (row: Row) => string;
  extra?: Record<string, unknown>;
}): string {
  const hasMore = input.total !== null
    ? input.offset + input.rows.length < input.total
    : input.rows.length > 0;
  const payload = {
    total: input.total,
    count: input.rows.length,
    offset: input.offset,
    has_more: hasMore,
    next_offset: hasMore ? input.offset + input.rows.length : null,
    ...(input.extra ?? {}),
    [input.itemLabel]: input.rows,
  };

  if (input.format === "json") return JSON.stringify(payload, null, 2);
  const totalText = input.total === null ? "celkový počet není dostupný" : `celkem ${input.total}`;
  const lines = [`# ${input.title}`, "", `Zobrazeno ${input.rows.length} položek, ${totalText}.`, ""];
  if (input.rows.length === 0) lines.push("Žádné odpovídající záznamy.");
  else lines.push(...input.rows.map(input.markdownRow));
  if (hasMore) lines.push("", `Další stránka: \`offset=${input.offset + input.rows.length}\`.`);
  return lines.join("\n");
}
