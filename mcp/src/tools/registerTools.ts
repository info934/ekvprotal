import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ResponseFormat } from "../constants.js";
import { errorResult, formatPagedRows, stringValue, textResult } from "../format.js";
import { optionalSearchSchema, pageFields, responseFormatSchema, uuidSchema } from "../schemas.js";
import { sanitizeSearchTerm, SupabaseRestClient } from "../services/supabaseRest.js";
import type { QueryFilter, Row } from "../types.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const searchScopes = ["projects", "realizations", "crm", "service", "subjects", "members", "tasks", "documents"] as const;
type SearchScope = typeof searchScopes[number];

interface SearchDefinition {
  table: string;
  select: string;
  fields: readonly string[];
  titleKey: string;
  codeKey?: string;
  order: string;
  label: string;
}

const searchDefinitions: Record<SearchScope, SearchDefinition> = {
  projects: { table: "projects", select: "id,name,code,status,location", fields: ["name", "code"], titleKey: "name", codeKey: "code", order: "name.asc", label: "Projekce" },
  realizations: { table: "realizations", select: "id,name,code,status,location_address", fields: ["name", "code"], titleKey: "name", codeKey: "code", order: "name.asc", label: "Realizace" },
  crm: { table: "crm_opportunities", select: "id,title,number,status,stage,priority,expected_close_date", fields: ["title", "number"], titleKey: "title", codeKey: "number", order: "updated_at.desc", label: "Obchodní případ" },
  service: { table: "service_cases", select: "id,title,number,status,priority,client_name,reported_at", fields: ["title", "number", "client_name"], titleKey: "title", codeKey: "number", order: "reported_at.desc", label: "Servis" },
  subjects: { table: "subjects", select: "id,name,ico,email,phone", fields: ["name", "ico"], titleKey: "name", codeKey: "ico", order: "name.asc", label: "Subjekt" },
  members: { table: "members", select: "id,name,email,user_role", fields: ["name", "email"], titleKey: "name", codeKey: "email", order: "name.asc", label: "Zaměstnanec" },
  tasks: { table: "project_tasks", select: "id,name,project_id,status,start_date,end_date,member_id", fields: ["name"], titleKey: "name", order: "end_date.asc", label: "Úkol" },
  documents: { table: "documents", select: "id,name,project_id,created_at", fields: ["name"], titleKey: "name", order: "created_at.desc", label: "Dokument" },
};

function searchOr(fields: readonly string[], term: string): string {
  return fields.map(field => `${field}.ilike.*${term}*`).join(",");
}

function optionalEqualFilter(filters: QueryFilter[], column: string, value: string | boolean | undefined): void {
  if (value !== undefined && value !== "") filters.push({ column, operator: "eq", value });
}

function markdownProject(row: Row): string {
  return `## ${stringValue(row, "name")} (${stringValue(row, "code")})\n- Stav: ${stringValue(row, "status")}\n- Typ: ${stringValue(row, "type")}\n- Termín: ${stringValue(row, "start_date")} až ${stringValue(row, "completion_date")}\n- ID: \`${stringValue(row, "id")}\``;
}

function markdownCrm(row: Row): string {
  const owner = typeof row.owner === "object" && row.owner !== null ? stringValue(row.owner as Row, "name") : stringValue(row, "owner_member_id");
  const subject = typeof row.subject === "object" && row.subject !== null ? stringValue(row.subject as Row, "name") : stringValue(row, "subject_id");
  return `## ${stringValue(row, "title")} (${stringValue(row, "number")})\n- Stav / fáze: ${stringValue(row, "status")} / ${stringValue(row, "stage")}\n- Priorita: ${stringValue(row, "priority")}\n- Zákazník: ${subject}\n- Vlastník: ${owner}\n- Očekávané uzavření: ${stringValue(row, "expected_close_date")}\n- Další krok: ${stringValue(row, "next_step")}\n- ID: \`${stringValue(row, "id")}\``;
}

function markdownTask(row: Row): string {
  const member = typeof row.member === "object" && row.member !== null ? stringValue(row.member as Row, "name") : stringValue(row, "member_id");
  return `## ${stringValue(row, "name")}\n- Stav: ${stringValue(row, "status")}\n- Termín: ${stringValue(row, "start_date")} až ${stringValue(row, "end_date")}\n- Postup: ${stringValue(row, "progress")}\n- Člen: ${member}\n- ID: \`${stringValue(row, "id")}\``;
}

function markdownService(row: Row): string {
  const assigned = typeof row.assigned === "object" && row.assigned !== null ? stringValue(row.assigned as Row, "name") : stringValue(row, "assigned_member_id");
  return `## ${stringValue(row, "title")} (${stringValue(row, "number")})\n- Stav: ${stringValue(row, "status")}\n- Priorita: ${stringValue(row, "priority")}\n- Klient: ${stringValue(row, "client_name")}\n- Přiřazeno: ${assigned}\n- Nahlášeno: ${stringValue(row, "reported_at")}\n- ID: \`${stringValue(row, "id")}\``;
}

export function registerPortalTools(server: McpServer, client: SupabaseRestClient): void {
  server.registerTool(
    "ekv_portal_health",
    {
      title: "Ověřit připojení k EKV Portálu",
      description: "Ověří konfiguraci, spojení se Supabase a základní oprávnění. Nevrací citlivé klíče ani osobní data. Použijte jako první krok při chybách připojení nebo oprávnění.",
      inputSchema: z.object({ response_format: responseFormatSchema }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ response_format }): Promise<CallToolResult> => {
      try {
        await client.query("members", { select: "id", limit: 1, count: false });
        const result = {
          ok: true,
          server: "ekv-portal-mcp-server",
          supabase_host: new URL(client.config.url).host,
          auth_mode: client.config.authMode,
          writes_enabled: client.config.writesEnabled,
          finance_via_service_role_enabled: client.config.allowServiceRoleFinance,
          rls_note: client.config.authMode === "user_access_token"
            ? `Dotazy běží pod přihlášeným uživatelem a respektují jeho RLS oprávnění; zápisy jsou ${client.config.writesEnabled ? "zapnuté" : "vypnuté"}.`
            : client.config.authMode === "user_session"
              ? `Dotazy běží pod technickým uživatelem z automaticky obnovované relace a respektují jeho RLS oprávnění; zápisy jsou ${client.config.writesEnabled ? "zapnuté" : "vypnuté"}.`
            : client.config.authMode === "service_role"
              ? "Service role obchází RLS. Zápisové nástroje s ní nelze zapnout; finanční nástroje jsou standardně blokované."
              : "Použitý API klíč nemusí mít uživatelská oprávnění; pro běžný provoz doplňte access token.",
        };
        return textResult(response_format === "json" ? JSON.stringify(result, null, 2) : `# EKV Portal MCP\n\n- Spojení: **v pořádku**\n- Supabase: \`${result.supabase_host}\`\n- Režim přihlášení: \`${result.auth_mode}\`\n- ${result.rls_note}`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ekv_portal_search",
    {
      title: "Prohledat EKV Portál",
      description: "Jedním dotazem hledá napříč zvolenými moduly portálu. Použijte k nalezení názvu a ID projektu, realizace, CRM případu, servisu, subjektu, člena, úkolu nebo dokumentu. Nástroj pouze čte data dostupná podle RLS.",
      inputSchema: z.object({
        query: z.string().trim().min(2).max(100).describe("Hledaný název, kód, číslo, e-mail nebo IČO."),
        scopes: z.array(z.enum(searchScopes)).min(1).max(searchScopes.length).default([...searchScopes]).describe("Moduly, které se mají prohledat."),
        limit_per_scope: z.number().int().min(1).max(20).default(6).describe("Maximum výsledků z jednoho modulu."),
        response_format: responseFormatSchema,
      }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ query, scopes, limit_per_scope, response_format }): Promise<CallToolResult> => {
      try {
        const term = sanitizeSearchTerm(query);
        if (term.length < 2) return errorResult(new Error("Po odstranění speciálních znaků musí mít dotaz alespoň 2 znaky."));
        const settled = await Promise.allSettled(scopes.map(async scope => {
          const definition = searchDefinitions[scope];
          const result = await client.query(definition.table, {
            select: definition.select,
            or: searchOr(definition.fields, term),
            order: definition.order,
            limit: limit_per_scope,
            count: false,
          });
          return result.rows.map(row => ({
            scope,
            kind: definition.label,
            id: row.id,
            title: row[definition.titleKey],
            code: definition.codeKey ? row[definition.codeKey] : undefined,
            data: row,
          }));
        }));
        const results = settled.flatMap(item => item.status === "fulfilled" ? item.value : []);
        const warnings = settled.flatMap((item, index) => item.status === "rejected" ? [`${scopes[index]}: ${item.reason instanceof Error ? item.reason.message : "chyba dotazu"}`] : []);
        if (response_format === "json") return textResult(JSON.stringify({ query: term, count: results.length, results, warnings }, null, 2));
        const lines = [`# Výsledky hledání „${term}“`, "", `Nalezeno ${results.length} položek.`, ""];
        for (const item of results) lines.push(`- **${String(item.title ?? item.kind)}** — ${item.kind}${item.code ? ` (${String(item.code)})` : ""}; ID: \`${String(item.id)}\``);
        if (!results.length) lines.push("Žádné odpovídající záznamy.");
        if (warnings.length) lines.push("", "## Neúplné moduly", ...warnings.map(warning => `- ${warning}`));
        return textResult(lines.join("\n"));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ekv_portal_list_projects",
    {
      title: "Vypsat projekty EKV",
      description: "Vrátí stránkovaný seznam projekčních zakázek s filtrem podle stavu, priority a textu. Použijte pro přehled portfolia nebo nalezení projektu před načtením jeho pracovního prostoru.",
      inputSchema: z.object({
        search: optionalSearchSchema,
        status: z.string().trim().min(1).max(50).optional().describe("Přesná hodnota stavu projektu."),
        priority_only: z.boolean().optional().describe("True omezí výsledek na prioritní projekty."),
        ...pageFields,
      }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ search, status, priority_only, limit, offset, response_format }): Promise<CallToolResult> => {
      try {
        const filters: QueryFilter[] = [];
        optionalEqualFilter(filters, "status", status);
        optionalEqualFilter(filters, "is_priority", priority_only);
        const term = search ? sanitizeSearchTerm(search) : "";
        const result = await client.query("projects", {
          select: "id,name,code,status,type,start_date,completion_date,location,is_priority,client_id,investor_id,crm_opportunity_id,created_at",
          filters,
          ...(term ? { or: searchOr(["name", "code", "location"], term) } : {}),
          order: "created_at.desc",
          limit,
          offset,
        });
        return textResult(formatPagedRows({ title: "Projekty EKV", itemLabel: "projects", rows: result.rows, total: result.total, offset, format: response_format as ResponseFormat, markdownRow: markdownProject }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ekv_portal_get_project_workspace",
    {
      title: "Načíst pracovní prostor projektu",
      description: "Načte jeden projekt včetně legacy úkolů, aktuálního plánu, plánovacích položek a navázaných realizací. Použijte pro souhrn stavu konkrétního projektu. Zadejte právě jedno z project_id nebo project_code.",
      inputSchema: z.object({
        project_id: uuidSchema.optional(),
        project_code: z.string().trim().min(1).max(100).optional().describe("Přesný kód projektu, například PR-26-001."),
        task_limit: z.number().int().min(1).max(100).default(50).describe("Maximum úkolů z každého úložiště."),
        response_format: responseFormatSchema,
      }).strict().refine(value => Number(Boolean(value.project_id)) + Number(Boolean(value.project_code)) === 1, { message: "Zadejte právě jedno z project_id nebo project_code." }),
      annotations: readOnlyAnnotations,
    },
    async ({ project_id, project_code, task_limit, response_format }): Promise<CallToolResult> => {
      try {
        const projectResult = await client.query("projects", {
          select: "id,name,code,status,type,start_date,completion_date,location,is_priority,brief,brief_editable,client_id,investor_id,crm_opportunity_id,created_at",
          filters: [{ column: project_id ? "id" : "code", operator: "eq", value: project_id ?? project_code ?? "" }],
          limit: 1,
          count: false,
        });
        const project = projectResult.rows[0];
        if (!project) return errorResult(new Error("Projekt nebyl nalezen nebo k němu aktuální uživatel nemá přístup."));
        const id = String(project.id);
        const [legacyTasks, plans, realizations] = await Promise.all([
          client.query("project_tasks", { select: "id,name,status,start_date,end_date,member_id,description,priority,estimated_hours,member:member_id(id,name)", filters: [{ column: "project_id", operator: "eq", value: id }], order: "end_date.asc", limit: task_limit }),
          client.query("planning_plans", { select: "id,title,status,planned_start,planned_end,baseline_version,updated_at", filters: [{ column: "project_id", operator: "eq", value: id }], limit: 1, count: false }),
          client.query("realizations", { select: "id,name,code,status,start_date,planned_end_date,actual_end_date,location_address", filters: [{ column: "linked_project_id", operator: "eq", value: id }], order: "created_at.desc", limit: 50 }),
        ]);
        const plan = plans.rows[0] ?? null;
        const planningItems = plan
          ? await client.query("planning_items", { select: "id,parent_id,legacy_project_task_id,item_type,name,description,start_date,end_date,progress,status,member_id,sort_order,member:member_id(id,name)", filters: [{ column: "plan_id", operator: "eq", value: String(plan.id) }], order: "sort_order.asc", limit: task_limit })
          : { rows: [], total: 0 };
        const payload = {
          project,
          summary: {
            legacy_task_count: legacyTasks.total ?? legacyTasks.rows.length,
            planning_item_count: planningItems.total ?? planningItems.rows.length,
            realization_count: realizations.total ?? realizations.rows.length,
          },
          plan,
          planning_items: planningItems.rows,
          legacy_tasks: legacyTasks.rows,
          realizations: realizations.rows,
        };
        if (response_format === "json") return textResult(JSON.stringify(payload, null, 2));
        const lines = [markdownProject(project), "", "# Souhrn pracovního prostoru", "", `- Legacy úkoly: ${payload.summary.legacy_task_count}`, `- Položky aktuálního plánu: ${payload.summary.planning_item_count}`, `- Navázané realizace: ${payload.summary.realization_count}`];
        if (plan) lines.push(`- Plán: ${stringValue(plan, "title")} (${stringValue(plan, "status")})`);
        if (planningItems.rows.length) lines.push("", "# Plánovací položky", "", ...planningItems.rows.map(markdownTask));
        if (legacyTasks.rows.length) lines.push("", "# Legacy úkoly", "", ...legacyTasks.rows.map(markdownTask));
        if (realizations.rows.length) lines.push("", "# Realizace", "", ...realizations.rows.map(row => `- ${stringValue(row, "name")} (${stringValue(row, "code")}) — ${stringValue(row, "status")}; ID: \`${stringValue(row, "id")}\``));
        return textResult(lines.join("\n"));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ekv_portal_list_crm_opportunities",
    {
      title: "Vypsat obchodní případy",
      description: "Vrátí stránkovaný seznam CRM obchodních případů s filtrem podle stavu, fáze, priority, vlastníka a textu. Ve výchozím stavu nezahrnuje měkce smazané záznamy.",
      inputSchema: z.object({
        search: optionalSearchSchema,
        status: z.string().trim().min(1).max(50).optional(),
        stage: z.string().trim().min(1).max(50).optional(),
        priority: z.string().trim().min(1).max(50).optional(),
        owner_member_id: uuidSchema.optional(),
        include_deleted: z.boolean().default(false),
        ...pageFields,
      }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ search, status, stage, priority, owner_member_id, include_deleted, limit, offset, response_format }): Promise<CallToolResult> => {
      try {
        const filters: QueryFilter[] = [];
        optionalEqualFilter(filters, "status", status);
        optionalEqualFilter(filters, "stage", stage);
        optionalEqualFilter(filters, "priority", priority);
        optionalEqualFilter(filters, "owner_member_id", owner_member_id);
        if (!include_deleted) filters.push({ column: "deleted_at", operator: "is", value: null });
        const term = search ? sanitizeSearchTerm(search) : "";
        const result = await client.query("crm_opportunities", {
          select: "id,number,title,stage,status,priority,value,probability,expected_close_date,next_step,subject_id,project_id,owner_member_id,created_at,updated_at,deleted_at,owner:owner_member_id(id,name,email),subject:subject_id(id,name,ico),project:project_id(id,name,code)",
          filters,
          ...(term ? { or: searchOr(["title", "number", "description"], term) } : {}),
          order: "updated_at.desc",
          limit,
          offset,
        });
        return textResult(formatPagedRows({ title: "Obchodní případy", itemLabel: "opportunities", rows: result.rows, total: result.total, offset, format: response_format as ResponseFormat, markdownRow: markdownCrm }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ekv_portal_list_planning_tasks",
    {
      title: "Vypsat plánované úkoly",
      description: "Vrátí úkoly z aktuálního plánovacího systému. Lze omezit na projekt, realizaci, plán, člena, stav a termín. Pokud zadáte projekt nebo realizaci, nástroj nejprve dohledá odpovídající plán.",
      inputSchema: z.object({
        project_id: uuidSchema.optional(),
        realization_id: uuidSchema.optional(),
        plan_id: uuidSchema.optional(),
        member_id: uuidSchema.optional(),
        status: z.enum(["planned", "ready", "in_progress", "blocked", "done", "cancelled"]).optional(),
        due_from: z.iso.date().optional().describe("Nejčasnější datum konce ve formátu YYYY-MM-DD."),
        due_to: z.iso.date().optional().describe("Nejzazší datum konce ve formátu YYYY-MM-DD."),
        search: optionalSearchSchema,
        ...pageFields,
      }).strict().refine(value => [value.project_id, value.realization_id, value.plan_id].filter(Boolean).length <= 1, { message: "Zadejte nejvýše jedno z project_id, realization_id nebo plan_id." }),
      annotations: readOnlyAnnotations,
    },
    async ({ project_id, realization_id, plan_id, member_id, status, due_from, due_to, search, limit, offset, response_format }): Promise<CallToolResult> => {
      try {
        let resolvedPlanId = plan_id;
        if (!resolvedPlanId && (project_id || realization_id)) {
          const plans = await client.query("planning_plans", { select: "id", filters: [{ column: project_id ? "project_id" : "realization_id", operator: "eq", value: project_id ?? realization_id ?? "" }], limit: 1, count: false });
          resolvedPlanId = typeof plans.rows[0]?.id === "string" ? plans.rows[0].id : undefined;
          if (!resolvedPlanId) return textResult(response_format === "json" ? JSON.stringify({ total: 0, count: 0, tasks: [] }, null, 2) : "# Plánované úkoly\n\nPro zadaný projekt nebo realizaci nebyl nalezen plán.");
        }
        const filters: QueryFilter[] = [{ column: "item_type", operator: "eq", value: "task" }];
        optionalEqualFilter(filters, "plan_id", resolvedPlanId);
        optionalEqualFilter(filters, "member_id", member_id);
        optionalEqualFilter(filters, "status", status);
        if (due_from) filters.push({ column: "end_date", operator: "gte", value: due_from });
        if (due_to) filters.push({ column: "end_date", operator: "lte", value: due_to });
        const term = search ? sanitizeSearchTerm(search) : "";
        const result = await client.query("planning_items", {
          select: "id,plan_id,parent_id,legacy_project_task_id,name,description,start_date,end_date,progress,status,member_id,location_id,sort_order,updated_at,member:member_id(id,name),plan:plan_id(id,title,project_id,realization_id)",
          filters,
          ...(term ? { or: searchOr(["name", "description"], term) } : {}),
          order: "end_date.asc",
          limit,
          offset,
        });
        return textResult(formatPagedRows({ title: "Plánované úkoly", itemLabel: "tasks", rows: result.rows, total: result.total, offset, format: response_format as ResponseFormat, markdownRow: markdownTask, ...(resolvedPlanId ? { extra: { resolved_plan_id: resolvedPlanId } } : {}) }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ekv_portal_list_service_cases",
    {
      title: "Vypsat servisní případy",
      description: "Vrátí stránkovaný přehled servisních případů s filtrem podle stavu, priority, přiřazeného člena a textu. Použijte pro servisní frontu, otevřené zásahy a dohledání konkrétního případu.",
      inputSchema: z.object({
        search: optionalSearchSchema,
        status: z.string().trim().min(1).max(50).optional(),
        priority: z.string().trim().min(1).max(50).optional(),
        assigned_member_id: uuidSchema.optional(),
        ...pageFields,
      }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ search, status, priority, assigned_member_id, limit, offset, response_format }): Promise<CallToolResult> => {
      try {
        const filters: QueryFilter[] = [];
        optionalEqualFilter(filters, "status", status);
        optionalEqualFilter(filters, "priority", priority);
        optionalEqualFilter(filters, "assigned_member_id", assigned_member_id);
        const term = search ? sanitizeSearchTerm(search) : "";
        const result = await client.query("service_cases", {
          select: "id,number,title,status,priority,client_name,reported_at,assigned_member_id,subject_id,project_id,realizace_id,opportunity_id,updated_at,assigned:assigned_member_id(id,name),subject:subject_id(id,name,ico),project:project_id(id,name,code),realizace:realizace_id(id,name,code)",
          filters,
          ...(term ? { or: searchOr(["title", "number", "client_name", "description"], term) } : {}),
          order: "reported_at.desc",
          limit,
          offset,
        });
        return textResult(formatPagedRows({ title: "Servisní případy", itemLabel: "service_cases", rows: result.rows, total: result.total, offset, format: response_format as ResponseFormat, markdownRow: markdownService }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
