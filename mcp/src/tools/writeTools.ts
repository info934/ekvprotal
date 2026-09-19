import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { errorResult, textResult } from "../format.js";
import { responseFormatSchema, uuidSchema } from "../schemas.js";
import { asRow, asUuid, assertWriteRpcAllowed, resolvePlanningPlanId } from "../services/planning.js";
import { SupabaseRestClient } from "../services/supabaseRest.js";
import type { Row } from "../types.js";

const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const idempotentWriteAnnotations = { ...writeAnnotations, idempotentHint: true } as const;
const destructiveAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;
const entityTypeSchema = z.enum(["project", "realization"]);
const statusSchema = z.enum(["planned", "ready", "in_progress", "blocked", "done", "cancelled"]);
const localDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/, "Použijte místní čas YYYY-MM-DDTHH:mm nebo YYYY-MM-DDTHH:mm:ss.");

const planningTargetShape = {
  plan_id: uuidSchema.optional(),
  entity_type: entityTypeSchema.optional(),
  entity_id: uuidSchema.optional(),
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

function mutationResult(responseFormat: "markdown" | "json", title: string, payload: Record<string, unknown>): CallToolResult {
  if (responseFormat === "json") return textResult(JSON.stringify(payload, null, 2));
  const lines = [`# ${title}`, ""];
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) lines.push(`- ${key}: ${String(value ?? "—")}`);
  }
  return textResult(lines.join("\n"));
}

async function requirePlanId(client: SupabaseRestClient, value: { plan_id?: string | undefined; entity_type?: "project" | "realization" | undefined; entity_id?: string | undefined }, createIfMissing: boolean): Promise<string> {
  const planId = await resolvePlanningPlanId(client, targetFrom(value), createIfMissing);
  if (!planId) throw new Error("Pro zadaný projekt nebo realizaci nebyl nalezen Gantt plán.");
  return planId;
}

async function requireOwnedRow(client: SupabaseRestClient, table: string, id: string, select: string, planId?: string): Promise<Row> {
  const filters = [{ column: "id", operator: "eq" as const, value: id }];
  if (planId) filters.push({ column: "plan_id", operator: "eq" as const, value: planId });
  const result = await client.query(table, { select, filters, limit: 1, count: false });
  const row = result.rows[0];
  if (!row) throw new Error("Záznam nebyl nalezen v požadovaném plánu nebo k němu nemáte přístup.");
  return row;
}

const memberAssignmentSchema = z.object({
  member_id: uuidSchema,
  role: z.string().trim().max(200).optional(),
  allocation_percent: z.number().positive().max(100).default(100),
  planned_hours: z.number().nonnegative().optional(),
}).strict();

const subcontractorAssignmentSchema = z.object({
  project_subcontractor_id: uuidSchema,
  role: z.string().trim().max(200).optional(),
  allocation_percent: z.number().positive().max(100).default(100),
  planned_hours: z.number().nonnegative().optional(),
}).strict();

const meetingPointSchema = z.object({
  kind: z.enum(["information", "decision", "task"]),
  text: z.string().trim().min(1).max(5000),
  planning_item_id: uuidSchema.optional(),
}).strict().refine(point => point.kind !== "task" || Boolean(point.planning_item_id), {
  message: "Bod typu task musí obsahovat planning_item_id. Nový úkol vytvořte nejprve jako information/decision a pak použijte ekv_portal_create_task_from_meeting_point.",
});

export function registerWriteTools(server: McpServer, client: SupabaseRestClient): void {
  if (!client.config.writesEnabled) return;

  server.registerTool(
    "ekv_portal_ensure_gantt_plan",
    {
      title: "Založit nebo dohledat Gantt plán",
      description: "Idempotentně dohledá Gantt plán projektu nebo realizace a v případě potřeby jej vytvoří. Vyžaduje právo upravovat danou zakázku.",
      inputSchema: z.object({ entity_type: entityTypeSchema, entity_id: uuidSchema, response_format: responseFormatSchema }).strict(),
      annotations: idempotentWriteAnnotations,
    },
    async ({ entity_type, entity_id, response_format }): Promise<CallToolResult> => {
      try {
        assertWriteRpcAllowed(client);
        const planId = await requirePlanId(client, { entity_type, entity_id }, true);
        return mutationResult(response_format, "Gantt plán je připraven", { plan_id: planId, entity_type, entity_id });
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    "ekv_portal_save_gantt_item",
    {
      title: "Vytvořit nebo upravit položku Ganttu",
      description: "Vytvoří nebo upraví fázi, úkol či milník v Ganttu projektu/realizace. Současně atomicky nahradí přiřazení lidí a subdodavatelů a ověří kapacity. Před úpravou načtěte aktuální plán.",
      inputSchema: z.object({
        ...planningTargetShape,
        item_id: uuidSchema.optional().describe("Vyplňte pouze při úpravě existující položky."),
        item_type: z.enum(["phase", "task", "milestone"]).default("task"),
        parent_id: uuidSchema.nullable().optional(),
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(10000).nullable().optional(),
        start_at: localDateTimeSchema,
        end_at: localDateTimeSchema.optional().describe("U milníku se ignoruje; jinak je povinný."),
        progress: z.number().min(0).max(1).default(0),
        status: statusSchema.default("planned"),
        member_id: uuidSchema.nullable().optional().describe("Primární odpovědná osoba."),
        member_assignments: z.array(memberAssignmentSchema).max(100).default([]),
        subcontractor_assignments: z.array(subcontractorAssignmentSchema).max(100).default([]),
        calendar_sync_enabled: z.boolean().default(false),
        sort_order: z.number().int().min(0).default(0),
        priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
        estimated_hours: z.number().positive().nullable().optional(),
        response_format: responseFormatSchema,
      }).strict()
        .refine(validTarget, { message: "Zadejte buď plan_id, nebo entity_type společně s entity_id." })
        .refine(value => value.item_type === "milestone" || Boolean(value.end_at), { message: "Fáze a úkol vyžadují end_at." })
        .refine(value => new Set(value.member_assignments.map(a => a.member_id)).size === value.member_assignments.length, { message: "Každý člen smí být v member_assignments pouze jednou." })
        .refine(value => new Set(value.subcontractor_assignments.map(a => a.project_subcontractor_id)).size === value.subcontractor_assignments.length, { message: "Každý subdodavatel smí být v subcontractor_assignments pouze jednou." }),
      annotations: writeAnnotations,
    },
    async (input): Promise<CallToolResult> => {
      try {
        assertWriteRpcAllowed(client);
        const planId = await requirePlanId(client, input, true);
        if (input.item_id) await requireOwnedRow(client, "planning_items", input.item_id, "id,plan_id,name", planId);
        const item = {
          parent_id: input.parent_id ?? null,
          item_type: input.item_type,
          name: input.name,
          description: input.description ?? null,
          start_at: input.start_at,
          end_at: input.item_type === "milestone" ? input.start_at : input.end_at,
          progress: input.progress,
          status: input.status,
          member_id: input.member_id ?? null,
          calendar_sync_enabled: input.item_type !== "phase" && input.calendar_sync_enabled,
          sort_order: input.sort_order,
          priority: input.priority,
          estimated_hours: input.estimated_hours ?? null,
        };
        const memberAssignments = [...input.member_assignments];
        if (input.member_id && !memberAssignments.some(assignment => assignment.member_id === input.member_id)) {
          memberAssignments.push({ member_id: input.member_id, allocation_percent: 100, ...(input.estimated_hours ? { planned_hours: input.estimated_hours } : {}) });
        }
        const savedId = asUuid(await client.rpc("save_planning_item_with_resources", {
          p_plan_id: planId,
          p_item_id: input.item_id ?? null,
          p_item: item,
          p_member_assignments: memberAssignments,
          p_subcontractor_assignments: input.subcontractor_assignments,
        }), "save_planning_item_with_resources");
        const saved = await requireOwnedRow(client, "planning_items", savedId, "id,plan_id,parent_id,item_type,name,description,start_date,end_date,start_at,end_at,progress,status,member_id,sort_order,priority,estimated_hours,updated_at", planId);
        return response_formatResult(input.response_format, "Položka Ganttu byla uložena", { plan_id: planId, item: saved });
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    "ekv_portal_quick_update_gantt_item",
    {
      title: "Rychle upravit úkol Ganttu",
      description: "Bezpečně změní stav, odpovědnou osobu nebo datum úkolu. Vhodné pro přesun karty, dokončení úkolu a jednoduchou změnu termínu.",
      inputSchema: z.object({
        item_id: uuidSchema,
        status: statusSchema.optional(),
        member_id: uuidSchema.nullable().optional(),
        start_date: z.iso.date().optional(),
        end_date: z.iso.date().optional(),
        response_format: responseFormatSchema,
      }).strict().refine(value => value.status !== undefined || value.member_id !== undefined || value.start_date !== undefined || value.end_date !== undefined, { message: "Zadejte alespoň jednu změnu." }),
      annotations: idempotentWriteAnnotations,
    },
    async (input): Promise<CallToolResult> => {
      try {
        assertWriteRpcAllowed(client);
        const changes: Record<string, unknown> = {};
        if (input.status !== undefined) changes.status = input.status;
        if (input.member_id !== undefined) changes.member_id = input.member_id;
        if (input.start_date !== undefined) changes.start_date = input.start_date;
        if (input.end_date !== undefined) changes.end_date = input.end_date;
        const item = asRow(await client.rpc("quick_update_planning_item", { p_item_id: input.item_id, p_changes: changes }), "quick_update_planning_item");
        return response_formatResult(input.response_format, "Položka Ganttu byla upravena", { item });
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    "ekv_portal_save_gantt_dependency",
    {
      title: "Přidat vazbu v Ganttu",
      description: "Přidá návaznost mezi dvěma položkami stejného plánu. Duplicitní vazbu vrátí beze změny; databáze odmítne cyklus.",
      inputSchema: z.object({
        plan_id: uuidSchema,
        predecessor_id: uuidSchema,
        successor_id: uuidSchema,
        dependency_type: z.enum(["fs", "ss", "ff", "sf"]).default("fs"),
        lag_days: z.number().int().min(-3650).max(3650).default(0),
        response_format: responseFormatSchema,
      }).strict().refine(value => value.predecessor_id !== value.successor_id, { message: "Předchůdce a následník musí být různé položky." }),
      annotations: idempotentWriteAnnotations,
    },
    async ({ plan_id, predecessor_id, successor_id, dependency_type, lag_days, response_format }): Promise<CallToolResult> => {
      try {
        assertWriteRpcAllowed(client);
        await Promise.all([
          requireOwnedRow(client, "planning_items", predecessor_id, "id,plan_id", plan_id),
          requireOwnedRow(client, "planning_items", successor_id, "id,plan_id", plan_id),
        ]);
        const existing = await client.query("planning_dependencies", {
          select: "id,plan_id,predecessor_id,successor_id,dependency_type,lag_days",
          filters: [
            { column: "plan_id", operator: "eq", value: plan_id },
            { column: "predecessor_id", operator: "eq", value: predecessor_id },
            { column: "successor_id", operator: "eq", value: successor_id },
            { column: "dependency_type", operator: "eq", value: dependency_type },
          ], limit: 1, count: false,
        });
        let dependency = existing.rows[0];
        if (dependency) {
          if (dependency.lag_days !== lag_days) dependency = (await client.update("planning_dependencies", [{ column: "id", operator: "eq", value: String(dependency.id) }, { column: "plan_id", operator: "eq", value: plan_id }], { lag_days }))[0];
        } else {
          dependency = (await client.insert("planning_dependencies", { plan_id, predecessor_id, successor_id, dependency_type, lag_days }))[0];
        }
        if (!dependency) throw new Error("Vazbu se nepodařilo uložit.");
        return response_formatResult(response_format, "Vazba Ganttu byla uložena", { dependency });
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    "ekv_portal_delete_gantt_dependency",
    {
      title: "Odstranit vazbu z Ganttu",
      description: "Odstraní konkrétní návaznost. Vyžaduje výslovné confirm=true. Opakované volání nad již odstraněnou vazbou je bezpečné.",
      inputSchema: z.object({ dependency_id: uuidSchema, confirm: z.literal(true), response_format: responseFormatSchema }).strict(),
      annotations: destructiveAnnotations,
    },
    async ({ dependency_id, response_format }): Promise<CallToolResult> => {
      try {
        assertWriteRpcAllowed(client);
        const existing = await client.query("planning_dependencies", { select: "id,plan_id", filters: [{ column: "id", operator: "eq", value: dependency_id }], limit: 1, count: false });
        if (!existing.rows[0]) return mutationResult(response_format, "Vazba už neexistuje", { dependency_id, deleted: false, already_absent: true });
        const deleted = await client.delete("planning_dependencies", [{ column: "id", operator: "eq", value: dependency_id }]);
        return mutationResult(response_format, "Vazba Ganttu byla odstraněna", { dependency_id, deleted: deleted.length > 0 });
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    "ekv_portal_delete_gantt_item",
    {
      title: "Odstranit položku Ganttu",
      description: "Odstraní fázi, úkol nebo milník a databázově navázané záznamy podle existujících pravidel. Ochrana vyžaduje confirm=true a přesný aktuální název položky.",
      inputSchema: z.object({ item_id: uuidSchema, expected_name: z.string().trim().min(1).max(200), confirm: z.literal(true), response_format: responseFormatSchema }).strict(),
      annotations: destructiveAnnotations,
    },
    async ({ item_id, expected_name, response_format }): Promise<CallToolResult> => {
      try {
        assertWriteRpcAllowed(client);
        const current = await client.query("planning_items", { select: "id,name,plan_id,item_type", filters: [{ column: "id", operator: "eq", value: item_id }], limit: 1, count: false });
        const item = current.rows[0];
        if (!item) return mutationResult(response_format, "Položka už neexistuje", { item_id, deleted: false, already_absent: true });
        if (item.name !== expected_name) throw new Error("expected_name neodpovídá aktuálnímu názvu položky. Znovu načtěte plán.");
        const deleted = await client.delete("planning_items", [{ column: "id", operator: "eq", value: item_id }, { column: "name", operator: "eq", value: expected_name }]);
        return mutationResult(response_format, "Položka Ganttu byla odstraněna", { item_id, name: expected_name, deleted: deleted.length > 0 });
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    "ekv_portal_save_meeting_note",
    {
      title: "Uložit zápis z kontrolního dne",
      description: "Vytvoří nebo verzovaně upraví interní zápis z KD. Při úpravě vyžaduje aktuální version, takže nepřepíše souběžnou změnu jiného uživatele.",
      inputSchema: z.object({
        ...planningTargetShape,
        note_id: uuidSchema.optional().describe("U nového zápisu lze vynechat; MCP vygeneruje UUID."),
        version: z.number().int().nonnegative().default(0).describe("0 pro nový zápis, aktuální verze pro úpravu."),
        title: z.string().trim().min(1).max(200),
        meeting_date: z.iso.date(),
        participants: z.string().max(5000).default(""),
        points: z.array(meetingPointSchema).max(100),
        response_format: responseFormatSchema,
      }).strict()
        .refine(validTarget, { message: "Zadejte buď plan_id, nebo entity_type společně s entity_id." })
        .refine(value => Boolean(value.note_id) || value.version === 0, { message: "Nový zápis bez note_id musí mít version=0." }),
      annotations: writeAnnotations,
    },
    async (input): Promise<CallToolResult> => {
      try {
        assertWriteRpcAllowed(client);
        const planId = await requirePlanId(client, input, true);
        const noteId = input.note_id ?? randomUUID();
        const note = asRow(await client.rpc("save_meeting_note", {
          p_id: noteId,
          p_plan_id: planId,
          p_version: input.version,
          p_title: input.title,
          p_date: input.meeting_date,
          p_participants: input.participants,
          p_points: input.points,
        }), "save_meeting_note");
        return response_formatResult(input.response_format, "Zápis z KD byl uložen", { note });
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    "ekv_portal_create_task_from_meeting_point",
    {
      title: "Vytvořit úkol z bodu kontrolního dne",
      description: "Atomicky vytvoří úkol v Ganttu z konkrétního bodu KD a zapíše jeho ID zpět do verzovaného zápisu. Vyžaduje aktuální verzi zápisu a dnešní nebo budoucí termín.",
      inputSchema: z.object({
        note_id: uuidSchema,
        version: z.number().int().positive(),
        point_index: z.number().int().nonnegative(),
        name: z.string().trim().min(1).max(200),
        due_date: z.iso.date(),
        member_id: uuidSchema,
        response_format: responseFormatSchema,
      }).strict(),
      annotations: writeAnnotations,
    },
    async ({ note_id, version, point_index, name, due_date, member_id, response_format }): Promise<CallToolResult> => {
      try {
        assertWriteRpcAllowed(client);
        const note = asRow(await client.rpc("create_meeting_point_task", {
          p_note_id: note_id,
          p_version: version,
          p_point_index: point_index,
          p_name: name,
          p_due: due_date,
          p_member_id: member_id,
        }), "create_meeting_point_task");
        return response_formatResult(response_format, "Úkol z bodu KD byl vytvořen", { note });
      } catch (error) { return errorResult(error); }
    },
  );

  registerTravelTools(server, client);
  registerAccommodationTools(server, client);
}

function response_formatResult(responseFormat: "markdown" | "json", title: string, payload: Record<string, unknown>): CallToolResult {
  if (responseFormat === "json") return textResult(JSON.stringify(payload, null, 2));
  return textResult(`# ${title}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``);
}

function registerTravelTools(server: McpServer, client: SupabaseRestClient): void {
  server.registerTool(
    "ekv_portal_save_travel_segment",
    {
      title: "Uložit cestu v plánu",
      description: "Vytvoří nebo upraví cestovní úsek navázaný na Gantt plán projektu či realizace.",
      inputSchema: z.object({
        plan_id: uuidSchema,
        travel_id: uuidSchema.optional(),
        item_id: uuidSchema.nullable().optional(),
        travel_date: z.iso.date(),
        origin_label: z.string().trim().min(1).max(500),
        destination_label: z.string().trim().min(1).max(500),
        travel_mode: z.enum(["car", "public_transport", "walk", "other"]).default("car"),
        distance_km: z.number().nonnegative().nullable().optional(),
        duration_minutes: z.number().int().nonnegative().nullable().optional(),
        departure_at: z.iso.datetime({ offset: true }).nullable().optional(),
        arrival_at: z.iso.datetime({ offset: true }).nullable().optional(),
        overnight_recommended: z.boolean().default(false),
        overnight_required: z.boolean().default(false),
        status: z.enum(["planned", "confirmed", "completed", "cancelled"]).default("planned"),
        notes: z.string().trim().max(10000).nullable().optional(),
        response_format: responseFormatSchema,
      }).strict().refine(value => !value.departure_at || !value.arrival_at || new Date(value.arrival_at) >= new Date(value.departure_at), { message: "arrival_at nesmí být před departure_at." }),
      annotations: writeAnnotations,
    },
    async (input): Promise<CallToolResult> => {
      try {
        assertWriteRpcAllowed(client);
        if (input.item_id) await requireOwnedRow(client, "planning_items", input.item_id, "id,plan_id", input.plan_id);
        if (input.travel_id) await requireOwnedRow(client, "planning_travel_segments", input.travel_id, "id,plan_id", input.plan_id);
        const values: Row = {
          plan_id: input.plan_id,
          item_id: input.item_id ?? null,
          travel_date: input.travel_date,
          origin_label: input.origin_label,
          destination_label: input.destination_label,
          travel_mode: input.travel_mode,
          route_provider: "manual",
          distance_m: input.distance_km == null ? null : Math.round(input.distance_km * 1000),
          duration_minutes: input.duration_minutes ?? null,
          departure_at: input.departure_at ?? null,
          arrival_at: input.arrival_at ?? null,
          overnight_recommended: input.overnight_recommended,
          overnight_required: input.overnight_required,
          status: input.status,
          notes: input.notes ?? null,
        };
        const rows = input.travel_id
          ? await client.update("planning_travel_segments", [{ column: "id", operator: "eq", value: input.travel_id }, { column: "plan_id", operator: "eq", value: input.plan_id }], values)
          : await client.insert("planning_travel_segments", values);
        if (!rows[0]) throw new Error("Cestu se nepodařilo uložit.");
        return response_formatResult(input.response_format, "Cesta byla uložena", { travel: rows[0] });
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    "ekv_portal_delete_travel_segment",
    {
      title: "Odstranit cestu z plánu",
      description: "Odstraní konkrétní cestovní úsek. Vyžaduje confirm=true.",
      inputSchema: z.object({ travel_id: uuidSchema, confirm: z.literal(true), response_format: responseFormatSchema }).strict(),
      annotations: destructiveAnnotations,
    },
    async ({ travel_id, response_format }): Promise<CallToolResult> => {
      try {
        assertWriteRpcAllowed(client);
        const deleted = await client.delete("planning_travel_segments", [{ column: "id", operator: "eq", value: travel_id }]);
        return mutationResult(response_format, "Cesta byla odstraněna", { travel_id, deleted: deleted.length > 0, already_absent: deleted.length === 0 });
      } catch (error) { return errorResult(error); }
    },
  );
}

function registerAccommodationTools(server: McpServer, client: SupabaseRestClient): void {
  server.registerTool(
    "ekv_portal_save_accommodation",
    {
      title: "Uložit ubytování v plánu",
      description: "Vytvoří nebo upraví ubytování v Gantt plánu a nahradí seznam ubytovaných členů týmu.",
      inputSchema: z.object({
        plan_id: uuidSchema,
        accommodation_id: uuidSchema.optional(),
        item_id: uuidSchema.nullable().optional(),
        hotel_name: z.string().trim().min(1).max(500),
        address: z.string().trim().max(1000).nullable().optional(),
        check_in: z.iso.date(),
        check_out: z.iso.date(),
        status: z.enum(["proposal", "approval", "booked", "completed", "cancelled"]).default("proposal"),
        booking_reference: z.string().trim().max(500).nullable().optional(),
        notes: z.string().trim().max(10000).nullable().optional(),
        guest_member_ids: z.array(uuidSchema).max(100).default([]),
        response_format: responseFormatSchema,
      }).strict().refine(value => value.check_out > value.check_in, { message: "check_out musí být po check_in." }),
      annotations: writeAnnotations,
    },
    async (input): Promise<CallToolResult> => {
      try {
        assertWriteRpcAllowed(client);
        if (input.item_id) await requireOwnedRow(client, "planning_items", input.item_id, "id,plan_id", input.plan_id);
        if (input.accommodation_id) await requireOwnedRow(client, "planning_accommodations", input.accommodation_id, "id,plan_id", input.plan_id);
        const values: Row = {
          plan_id: input.plan_id,
          item_id: input.item_id ?? null,
          hotel_name: input.hotel_name,
          address: input.address ?? null,
          check_in: input.check_in,
          check_out: input.check_out,
          status: input.status,
          booking_reference: input.booking_reference ?? null,
          notes: input.notes ?? null,
        };
        const rows = input.accommodation_id
          ? await client.update("planning_accommodations", [{ column: "id", operator: "eq", value: input.accommodation_id }, { column: "plan_id", operator: "eq", value: input.plan_id }], values)
          : await client.insert("planning_accommodations", values);
        const accommodation = rows[0];
        if (!accommodation || typeof accommodation.id !== "string") throw new Error("Ubytování se nepodařilo uložit.");
        await client.rpc("replace_planning_accommodation_guests", { p_accommodation_id: accommodation.id, p_member_ids: [...new Set(input.guest_member_ids)] });
        return response_formatResult(input.response_format, "Ubytování bylo uloženo", { accommodation, guest_member_ids: input.guest_member_ids });
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    "ekv_portal_delete_accommodation",
    {
      title: "Odstranit ubytování z plánu",
      description: "Odstraní konkrétní ubytování včetně databázově navázaných hostů. Vyžaduje confirm=true.",
      inputSchema: z.object({ accommodation_id: uuidSchema, confirm: z.literal(true), response_format: responseFormatSchema }).strict(),
      annotations: destructiveAnnotations,
    },
    async ({ accommodation_id, response_format }): Promise<CallToolResult> => {
      try {
        assertWriteRpcAllowed(client);
        const deleted = await client.delete("planning_accommodations", [{ column: "id", operator: "eq", value: accommodation_id }]);
        return mutationResult(response_format, "Ubytování bylo odstraněno", { accommodation_id, deleted: deleted.length > 0, already_absent: deleted.length === 0 });
      } catch (error) { return errorResult(error); }
    },
  );
}
