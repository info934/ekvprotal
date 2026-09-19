import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { errorResult, textResult } from "../format.js";
import { responseFormatSchema, uuidSchema } from "../schemas.js";
import { SupabaseRequestError, SupabaseRestClient } from "../services/supabaseRest.js";
import type { JsonValue } from "../types.js";

const readOnlyAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function assertFinanceAccessMode(client: SupabaseRestClient): void {
  if (client.config.authMode === "service_role" && !client.config.allowServiceRoleFinance) {
    throw new SupabaseRequestError("Finance přes service role jsou vypnuté. Použijte uživatelský access token, nebo v chráněném prostředí výslovně nastavte EKV_PORTAL_ALLOW_SERVICE_ROLE_FINANCE=true.", 403);
  }
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function markdownFinance(title: string, payload: Record<string, unknown>): string {
  const lines = [`# ${title}`, ""];
  const summary = payload.summary;
  if (typeof summary === "object" && summary !== null && !Array.isArray(summary)) {
    for (const [key, value] of Object.entries(summary)) {
      if (["string", "number", "boolean"].includes(typeof value) || value === null) lines.push(`- ${key}: ${String(value ?? "—")}`);
    }
  }
  if (lines.length === 2) {
    for (const [key, value] of Object.entries(payload)) {
      if (["string", "number", "boolean"].includes(typeof value) || value === null) lines.push(`- ${key}: ${String(value ?? "—")}`);
    }
  }
  lines.push("", "## Strukturovaná data", "", "```json", JSON.stringify(jsonValue(payload), null, 2), "```");
  return lines.join("\n");
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SupabaseRequestError(`${label} nevrátilo očekávaný finanční objekt.`, 502);
  return value as Record<string, unknown>;
}

export function registerFinanceTools(server: McpServer, client: SupabaseRestClient): void {
  server.registerTool(
    "ekv_portal_get_project_finances",
    {
      title: "Načíst finance projektu",
      description: "Načte autoritativní finanční souhrn projektu a pracovní/odměnovou část z backendových RPC. Obsahuje výnosy, náklady, režie, výplaty, marži a dostupné odměny podle oprávnění uživatele. Nástroj finance nemění.",
      inputSchema: z.object({ project_id: uuidSchema, response_format: responseFormatSchema }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ project_id, response_format }): Promise<CallToolResult> => {
      try {
        assertFinanceAccessMode(client);
        const [summary, labor] = await Promise.all([
          client.rpc("project_financial_summary", { p_project_id: project_id }),
          client.rpc("project_labor_financial_summary", { p_project_id: project_id }),
        ]);
        const payload = { project_id, summary: asObject(summary, "project_financial_summary"), labor: asObject(labor, "project_labor_financial_summary") };
        return textResult(response_format === "json" ? JSON.stringify(payload, null, 2) : markdownFinance("Finance projektu", payload));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ekv_portal_get_realization_finances",
    {
      title: "Načíst finance realizace",
      description: "Načte autoritativní finanční náhled realizace a souhrn práce/odměn. Používá stejná backendová RPC jako detail realizace v portálu a respektuje finanční oprávnění uživatele.",
      inputSchema: z.object({ realization_id: uuidSchema, response_format: responseFormatSchema }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ realization_id, response_format }): Promise<CallToolResult> => {
      try {
        assertFinanceAccessMode(client);
        const [summary, labor] = await Promise.all([
          client.rpc("realization_financial_preview", { p_realization_id: realization_id, p_overrides: {}, p_shares: null }),
          client.rpc("realization_labor_financial_summary", { p_realization_id: realization_id }),
        ]);
        const payload = { realization_id, summary: asObject(summary, "realization_financial_preview"), labor: asObject(labor, "realization_labor_financial_summary") };
        return textResult(response_format === "json" ? JSON.stringify(payload, null, 2) : markdownFinance("Finance realizace", payload));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ekv_portal_get_finance_overview",
    {
      title: "Načíst firemní přehled financí realizací",
      description: "Vrátí backendem vypočtený souhrnný přehled všech dostupných realizací. Je určen pro sledování obratu, nákladů, zisku a agregací; přístup řídí finanční RLS oprávnění.",
      inputSchema: z.object({ response_format: responseFormatSchema }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ response_format }): Promise<CallToolResult> => {
      try {
        assertFinanceAccessMode(client);
        const overview = asObject(await client.rpc("get_realization_financial_overview"), "get_realization_financial_overview");
        return textResult(response_format === "json" ? JSON.stringify(overview, null, 2) : markdownFinance("Finanční přehled realizací", overview));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
