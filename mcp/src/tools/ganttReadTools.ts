import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { errorResult, textResult } from "../format.js";
import { responseFormatSchema, uuidSchema } from "../schemas.js";
import { asRows, resolvePlanningPlanId } from "../services/planning.js";
import { SupabaseRestClient } from "../services/supabaseRest.js";
import type { Row } from "../types.js";

const readOnlyAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const entityTypeSchema = z.enum(["project", "realization"]);

const planningTargetShape = {
  plan_id: uuidSchema.optional(),
  entity_type: entityTypeSchema.optional().describe("Typ zakázky při dohledání plánu."),
  entity_id: uuidSchema.optional().describe("ID projektu nebo realizace při dohledání plánu."),
};

function validTarget(value: { plan_id?: string | undefined; entity_type?: string | undefined; entity_id?: string | undefined }): boolean {
  return Boolean(value.plan_id && !value.entity_type && !value.entity_id)
    || Boolean(!value.plan_id && value.entity_type && value.entity_id);
}

function targetFrom(value: { plan_id?: string | undefined; entity_type?: "project" | "realization" | undefined; entity_id?: string | undefined }) {
  return {
    ...(value.plan_id ? { planId: value.plan_id } : {}),
    ...(value.entity_type ? { entityType: value.entity_type } : {}),
    ...(value.entity_id ? { entityId: value.entity_id } : {}),
  };
}

function markdownGantt(payload: {
  plan: Row;
  items: Row[];
  dependencies: Row[];
  assignments: Row[];
  subcontractor_assignments: Row[];
  travel: Row[];
  accommodations: Row[];
}): string {
  const lines = [
    `# Gantt plán: ${String(payload.plan.title ?? payload.plan.id ?? "bez názvu")}`,
    "",
    `- Stav: ${String(payload.plan.status ?? "—")}`,
    `- Rozsah: ${String(payload.plan.planned_start ?? "—")} až ${String(payload.plan.planned_end ?? "—")}`,
    `- Položky: ${payload.items.length}`,
    `- Vazby: ${payload.dependencies.length}`,
    `- Přiřazení lidí: ${payload.assignments.length}`,
    `- Přiřazení subdodavatelů: ${payload.subcontractor_assignments.length}`,
    `- Cesty / ubytování: ${payload.travel.length} / ${payload.accommodations.length}`,
    "",
    "## Položky",
    "",
  ];
  if (!payload.items.length) lines.push("Plán zatím nemá žádné položky.");
  for (const item of payload.items) {
    const member = typeof item.member === "object" && item.member !== null ? (item.member as Row).name : item.member_id;
    lines.push(`- **${String(item.name ?? "Bez názvu")}** [${String(item.item_type ?? "task")}] — ${String(item.status ?? "—")}, ${String(item.start_date ?? "—")} až ${String(item.end_date ?? "—")}, řešitel ${String(member ?? "nepřiřazen")}; ID: \`${String(item.id)}\``);
  }
  if (payload.dependencies.length) {
    lines.push("", "## Vazby", "");
    for (const dependency of payload.dependencies) lines.push(`- ${String(dependency.predecessor_id)} → ${String(dependency.successor_id)} (${String(dependency.dependency_type)}, posun ${String(dependency.lag_days)} dní); ID: \`${String(dependency.id)}\``);
  }
  return lines.join("\n");
}

export function registerGanttReadTools(server: McpServer, client: SupabaseRestClient): void {
  server.registerTool(
    "ekv_portal_get_gantt_plan",
    {
      title: "Načíst kompletní Gantt plán",
      description: "Načte kompletní plán projektu nebo realizace: fáze, úkoly, milníky, vazby, vytížení lidí a subdodavatelů, cesty, ubytování a dostupné zdroje. Použijte před jakýmkoli plánovacím zápisem, abyste pracovali s aktuálními ID a verzí reality.",
      inputSchema: z.object({
        ...planningTargetShape,
        response_format: responseFormatSchema,
      }).strict().refine(validTarget, { message: "Zadejte buď plan_id, nebo entity_type společně s entity_id." }),
      annotations: readOnlyAnnotations,
    },
    async ({ plan_id, entity_type, entity_id, response_format }): Promise<CallToolResult> => {
      try {
        const resolvedPlanId = await resolvePlanningPlanId(client, targetFrom({ plan_id, entity_type, entity_id }), false);
        if (!resolvedPlanId) return errorResult(new Error("Pro zadanou zakázku nebyl nalezen Gantt plán."));
        const planResult = await client.query("planning_plans", { select: "id,project_id,realization_id,title,status,timezone,planned_start,planned_end,baseline_version,created_at,updated_at", filters: [{ column: "id", operator: "eq", value: resolvedPlanId }], limit: 1, count: false });
        const plan = planResult.rows[0];
        if (!plan) return errorResult(new Error("Plán nebyl nalezen nebo k němu uživatel nemá oprávnění."));
        const itemsResult = await client.query("planning_items", {
          select: "id,plan_id,parent_id,legacy_project_task_id,item_type,name,description,start_date,end_date,start_at,end_at,progress,status,member_id,location_id,sort_order,color,constraint_type,constraint_date,calendar_sync_enabled,priority,estimated_hours,created_at,updated_at,member:member_id(id,name,email)",
          filters: [{ column: "plan_id", operator: "eq", value: resolvedPlanId }],
          order: "sort_order.asc",
          limit: 500,
        });
        const itemIds = itemsResult.rows.map(row => String(row.id));
        const [dependencies, assignments, subcontractorAssignments, travel, accommodations, membersRaw, subcontractorsRaw] = await Promise.all([
          client.query("planning_dependencies", { select: "id,plan_id,predecessor_id,successor_id,dependency_type,lag_days,created_at", filters: [{ column: "plan_id", operator: "eq", value: resolvedPlanId }], order: "created_at.asc", limit: 1000 }),
          itemIds.length ? client.query("planning_assignments", { select: "id,item_id,member_id,role,allocation_percent,planned_hours,member:member_id(id,name,email)", filters: [{ column: "item_id", operator: "in", value: itemIds }], order: "created_at.asc", limit: 1000 }) : Promise.resolve({ rows: [], total: 0 }),
          itemIds.length ? client.query("planning_subcontractor_assignments", { select: "id,item_id,project_subcontractor_id,role,allocation_percent,planned_hours", filters: [{ column: "item_id", operator: "in", value: itemIds }], order: "created_at.asc", limit: 1000 }) : Promise.resolve({ rows: [], total: 0 }),
          client.query("planning_travel_segments", { select: "id,plan_id,item_id,travel_date,origin_label,destination_label,travel_mode,distance_m,duration_minutes,departure_at,arrival_at,overnight_recommended,overnight_required,status,notes", filters: [{ column: "plan_id", operator: "eq", value: resolvedPlanId }], order: "travel_date.asc", limit: 500 }),
          client.query("planning_accommodations", { select: "id,plan_id,item_id,hotel_name,address,check_in,check_out,status,booking_reference,notes,guests:planning_accommodation_guests(member_id)", filters: [{ column: "plan_id", operator: "eq", value: resolvedPlanId }], order: "check_in.asc", limit: 500 }),
          client.rpc("list_planning_members_safe", { p_plan_id: resolvedPlanId }),
          client.rpc("list_planning_subcontractors_safe", { p_plan_id: resolvedPlanId }),
        ]);
        const payload = {
          plan,
          items: itemsResult.rows,
          dependencies: dependencies.rows,
          assignments: assignments.rows,
          subcontractor_assignments: subcontractorAssignments.rows,
          travel: travel.rows,
          accommodations: accommodations.rows,
          available_members: asRows(membersRaw, "list_planning_members_safe"),
          available_subcontractors: asRows(subcontractorsRaw, "list_planning_subcontractors_safe"),
        };
        return textResult(response_format === "json" ? JSON.stringify(payload, null, 2) : markdownGantt(payload));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ekv_portal_list_meeting_notes",
    {
      title: "Vypsat zápisy z kontrolních dnů",
      description: "Vrátí interní pracovní zápisy a body kontrolních dnů pro konkrétní Gantt plán, včetně odkazů na vytvořené úkoly. Nástroj nic nemění.",
      inputSchema: z.object({
        ...planningTargetShape,
        limit: z.number().int().min(1).max(100).default(20),
        response_format: responseFormatSchema,
      }).strict().refine(validTarget, { message: "Zadejte buď plan_id, nebo entity_type společně s entity_id." }),
      annotations: readOnlyAnnotations,
    },
    async ({ plan_id, entity_type, entity_id, limit, response_format }): Promise<CallToolResult> => {
      try {
        const resolvedPlanId = await resolvePlanningPlanId(client, targetFrom({ plan_id, entity_type, entity_id }), false);
        if (!resolvedPlanId) return errorResult(new Error("Pro zadanou zakázku nebyl nalezen plán."));
        const result = await client.query("meeting_notes", { select: "id,plan_id,title,meeting_date,participants,points,version,updated_at,updated_by", filters: [{ column: "plan_id", operator: "eq", value: resolvedPlanId }], order: "meeting_date.desc", limit });
        if (response_format === "json") return textResult(JSON.stringify({ plan_id: resolvedPlanId, total: result.total, notes: result.rows }, null, 2));
        const lines = ["# Zápisy z kontrolních dnů", "", `Nalezeno ${result.rows.length} zápisů.`, ""];
        for (const note of result.rows) {
          const points = Array.isArray(note.points) ? note.points : [];
          lines.push(`## ${String(note.title)} — ${String(note.meeting_date)}\n- Verze: ${String(note.version)}\n- Účastníci: ${String(note.participants || "—")}\n- Bodů: ${points.length}\n- ID: \`${String(note.id)}\``);
        }
        return textResult(lines.join("\n"));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
