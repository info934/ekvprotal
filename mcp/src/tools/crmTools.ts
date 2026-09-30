import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { errorResult, formatPagedRows, textResult } from "../format.js";
import { pageFields, responseFormatSchema, uuidSchema } from "../schemas.js";
import { asRow, assertWriteRpcAllowed } from "../services/planning.js";
import { SupabaseRestClient } from "../services/supabaseRest.js";
import type { QueryFilter, Row } from "../types.js";

const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const destructive = { ...write, destructiveHint: true } as const;
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const nullableText = z.string().trim().max(10000).nullable();
const nullableId = uuidSchema.nullable();
const stage = z.string().trim().min(1).max(80);
const activityType = z.enum(["call", "meeting", "email", "task", "note"]);
const activityStatus = z.enum(["planned", "in_progress", "completed", "cancelled"]);
const participantRole = z.enum(["decision_maker", "technical_contact", "customer_contact", "supplier", "partner", "advisor", "observer", "stakeholder"]);

function result(format: "markdown" | "json", title: string, data: unknown): CallToolResult {
  return textResult(format === "json" ? JSON.stringify(data, null, 2) : `# ${title}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
}

function one(rows: Row[], label: string): Row {
  if (rows.length !== 1) throw new Error(`${label} nebyl nalezen nebo k němu nemáte přístup. U změny ověřte aktuální updated_at a zkuste znovu.`);
  return rows[0]!;
}

async function lookup(client: SupabaseRestClient, table: string, id: string, select = "*"): Promise<Row> {
  const response = await client.query(table, { select, filters: [{ column: "id", operator: "eq", value: id }], limit: 1, count: false });
  return one(response.rows, "Záznam");
}

const opportunityCreate = z.object({
  title: z.string().trim().min(2).max(300),
  subject_id: uuidSchema,
  project_id: nullableId.optional(),
  owner_member_id: nullableId.optional(),
  template_id: nullableId.optional(),
  stage: stage.default("lead"),
  status: z.enum(["open", "closed"]).default("open"),
  priority: z.string().trim().min(1).max(80).default("medium"),
  value: z.number().finite().nonnegative().default(0),
  probability: z.number().int().min(0).max(100).default(0),
  expected_close_date: date.nullable().optional(),
  next_step: nullableText.optional(),
  description: nullableText.optional(),
  source: nullableText.optional(),
  business_type: nullableText.optional(),
  category: nullableText.optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
}).strict();

const opportunityPatch = opportunityCreate.omit({ subject_id: true }).partial().extend({
  title: z.string().trim().min(2).max(300).optional(),
  subject_id: uuidSchema.optional(),
  stage: stage.optional(),
  status: z.enum(["open", "closed", "won", "lost", "cancelled"]).optional(),
  priority: z.string().trim().min(1).max(80).optional(),
  value: z.number().finite().nonnegative().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  lost_reason: nullableText.optional(),
  lost_at: timestamp.nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
});

const item = z.object({
  catalog_item_id: nullableId.optional(), code: nullableText.optional(), name: z.string().trim().min(1).max(500),
  description: nullableText.optional(), quantity: z.number().finite().nonnegative(), unit: z.string().trim().min(1).max(30),
  unit_price: z.number().finite().nonnegative(), unit_cost: z.number().finite().nonnegative().optional(),
  purchase_price_snapshot: z.number().finite().nonnegative().optional(),
  discount_percent: z.number().finite().min(0).max(100).default(0), vat_rate: z.number().finite().min(0).max(100).default(21),
  commission_percent: z.number().finite().min(0).max(100).optional(),
  product_sku: nullableText.optional(), product_type: nullableText.optional(),
  stock_available_snapshot: z.number().finite().nonnegative().nullable().optional(),
  catalog_price_snapshot: z.number().finite().nonnegative().nullable().optional(),
  supplier_offer_id: nullableId.optional(), supplier_name: nullableText.optional(), supplier_sku_snapshot: nullableText.optional(),
  sort_order: z.number().int().optional(), section_name: nullableText.optional(),
  item_kind: z.enum(["standard", "optional", "alternative"]).default("standard"),
  alternative_group: nullableText.optional(), included_in_total: z.boolean().default(true),
}).strict();

const activityFields = z.object({
  title: z.string().trim().min(1).max(500), type: activityType, status: activityStatus,
  description: nullableText.optional(), assigned_member_id: nullableId.optional(),
  starts_at: timestamp.nullable().optional(), ends_at: timestamp.nullable().optional(),
  location: nullableText.optional(), outcome: nullableText.optional(), meeting_minutes: nullableText.optional(), next_step: nullableText.optional(),
  attendees: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
}).strict();

export function registerCrmTools(server: McpServer, client: SupabaseRestClient): void {
  server.registerTool("ekv_portal_get_crm_config", {
    title: "CRM fáze, priority a šablony", description: "Vrátí aktivní fáze, priority, šablony aktivit a definice vlastních polí pro správnou přípravu obchodního případu.",
    inputSchema: z.object({ response_format: responseFormatSchema }).strict(), annotations: read,
  }, async ({ response_format }): Promise<CallToolResult> => {
    try {
      const data: Record<string, unknown> = {};
      for (const [key, table, order] of [
        ["stages", "crm_stage_definitions", "sort_order.asc"],
        ["priorities", "crm_priority_definitions", "sort_order.asc"],
        ["templates", "crm_opportunity_templates", "name.asc"],
        ["custom_field_sections", "crm_custom_field_sections", "sort_order.asc"],
        ["custom_field_definitions", "crm_custom_field_definitions", "sort_order.asc"],
      ] as const) {
        const page = await client.query(table, { select: "*", filters: [{ column: "is_active", operator: "eq", value: true }], order, limit: 200, count: true });
        data[key] = page.rows;
        data[`${key}_total`] = page.total;
      }
      return result(response_format, "Nastavení CRM", data);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_get_crm_opportunity", {
    title: "Detail CRM obchodního případu", description: "Načte obchodní případ a navázané položky, účastníky, poznámky, poslední aktivity, nabídky/objednávky a auditní události. Seznamy jsou omezené na posledních 50 řádků.",
    inputSchema: z.object({ opportunity_id: uuidSchema, response_format: responseFormatSchema }).strict(), annotations: read,
  }, async ({ opportunity_id, response_format }): Promise<CallToolResult> => {
    try {
      const opportunity = await lookup(client, "crm_opportunities", opportunity_id);
      const specs = [
        ["items", "crm_opportunity_items", "sort_order.asc"],
        ["participants", "crm_opportunity_participants", "is_primary.desc,created_at.asc"],
        ["notes", "crm_notes", "created_at.desc"],
        ["activities", "crm_activities", "created_at.desc"],
        ["documents", "crm_commercial_documents", "created_at.desc"],
        ["events", "crm_opportunity_events", "created_at.desc"],
      ] as const;
      const data: Record<string, unknown> = { opportunity };
      for (const [key, table, order] of specs) {
        const page = await client.query(table, { select: "*", filters: [{ column: "opportunity_id", operator: "eq", value: opportunity_id }], order, limit: 50, count: true });
        data[key] = page.rows;
        data[`${key}_total`] = page.total;
      }
      return result(response_format, "CRM obchodní případ", data);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_list_crm_activities", {
    title: "CRM aktivity", description: "Stránkovaně čte obchodní hovory, schůzky, e-maily, úkoly a poznámky. Lze filtrovat podle případu, přiřazené osoby, typu a stavu.",
    inputSchema: z.object({ opportunity_id: uuidSchema.optional(), assigned_member_id: uuidSchema.optional(), type: activityType.optional(), status: activityStatus.optional(), ...pageFields }).strict(), annotations: read,
  }, async ({ opportunity_id, assigned_member_id, type, status, limit, offset, response_format }): Promise<CallToolResult> => {
    try {
      const filters: QueryFilter[] = [];
      for (const [column, value] of Object.entries({ opportunity_id, assigned_member_id, type, status })) if (value) filters.push({ column, operator: "eq", value });
      const page = await client.query("crm_activities", { select: "*", filters, order: "created_at.desc", limit, offset });
      return textResult(formatPagedRows({ title: "CRM aktivity", itemLabel: "activities", rows: page.rows, total: page.total, offset, format: response_format, markdownRow: row => `- ${row.title} (${row.type}, ${row.status}), ID: ${row.id}, termín: ${row.starts_at ?? row.due_at ?? "—"}` }));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_list_crm_documents", {
    title: "Nabídky a objednávky CRM", description: "Stránkovaně čte obchodní dokumenty bez měkce smazaných záznamů.",
    inputSchema: z.object({ opportunity_id: uuidSchema.optional(), type: z.enum(["offer", "order"]).optional(), status: z.string().trim().min(1).max(50).optional(), ...pageFields }).strict(), annotations: read,
  }, async ({ opportunity_id, type, status, limit, offset, response_format }): Promise<CallToolResult> => {
    try {
      const filters: QueryFilter[] = [{ column: "deleted_at", operator: "is", value: null }];
      for (const [column, value] of Object.entries({ opportunity_id, type, status })) if (value) filters.push({ column, operator: "eq", value });
      const page = await client.query("crm_commercial_documents", { select: "*", filters, order: "created_at.desc", limit, offset });
      return textResult(formatPagedRows({ title: "CRM nabídky a objednávky", itemLabel: "documents", rows: page.rows, total: page.total, offset, format: response_format, markdownRow: row => `- ${row.number ?? "—"} ${row.title} (${row.type}, ${row.status}), celkem ${row.total ?? "—"}, ID: ${row.id}` }));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_get_crm_document", {
    title: "Detail nabídky nebo objednávky", description: "Vrátí obchodní dokument, jeho položky, verze, doručení a události (posledních 50 z každé evidence).",
    inputSchema: z.object({ document_id: uuidSchema, response_format: responseFormatSchema }).strict(), annotations: read,
  }, async ({ document_id, response_format }): Promise<CallToolResult> => {
    try {
      const document = await lookup(client, "crm_commercial_documents", document_id);
      const data: Record<string, unknown> = { document };
      for (const [key, table, order] of [
        ["items", "crm_commercial_document_items", "sort_order.asc"],
        ["versions", "crm_commercial_document_versions", "created_at.desc"],
        ["deliveries", "crm_commercial_document_deliveries", "created_at.desc"],
        ["events", "crm_commercial_document_events", "created_at.desc"],
      ] as const) {
        const page = await client.query(table, { select: "*", filters: [{ column: "document_id", operator: "eq", value: document_id }], order, limit: 50 });
        data[key] = page.rows;
        data[`${key}_total`] = page.total;
      }
      return result(response_format, "CRM dokument", data);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_get_crm_sales_performance", {
    title: "Výkon obchodu CRM", description: "Vrátí databázově spočítaný přehled aktivit, nabídek, přijatých tržeb a cílů za období nejvýše 366 dnů. Vyžaduje CRM administrátorské oprávnění.",
    inputSchema: z.object({ from: date, to: date, response_format: responseFormatSchema }).strict(), annotations: read,
  }, async ({ from, to, response_format }): Promise<CallToolResult> => {
    try {
      if (to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 366) throw new Error("Období musí být nejvýše 366 dnů a datum do nesmí předcházet datu od.");
      const performance = await client.rpc("get_crm_sales_performance", { p_from: from, p_to: to });
      return result(response_format, "Výkon obchodu CRM", { from, to, performance });
    } catch (error) { return errorResult(error); }
  });

  if (!client.config.writesEnabled) return;

  server.registerTool("ekv_portal_create_crm_opportunity", {
    title: "Založit CRM obchodní případ", description: "Založí obchodní případ s automaticky přiděleným číslem. Před opakováním po chybě ověřte seznam, aby nevznikla duplicita.",
    inputSchema: z.object({ opportunity: opportunityCreate, response_format: responseFormatSchema }).strict(), annotations: write,
  }, async ({ opportunity, response_format }): Promise<CallToolResult> => {
    try {
      assertWriteRpcAllowed(client);
      const number = await client.rpc("allocate_crm_number", { p_document_type: "opportunity" });
      if (typeof number !== "string" || !number) throw new Error("Číslovací RPC nevrátilo číslo případu.");
      const created = one(await client.insert("crm_opportunities", { ...opportunity, number }), "Nový obchodní případ");
      return result(response_format, "Obchodní případ založen", created);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_update_crm_opportunity", {
    title: "Upravit CRM obchodní případ", description: "Upraví pouze uvedená pole. Vyžaduje přesný updated_at z detailu případu; souběžnou změnu odmítne. Při změně fáze zadejte zároveň odpovídající status.",
    inputSchema: z.object({ opportunity_id: uuidSchema, expected_updated_at: timestamp, changes: opportunityPatch.refine(value => Object.keys(value).length > 0, "Zadejte alespoň jedno pole."), response_format: responseFormatSchema }).strict(), annotations: write,
  }, async ({ opportunity_id, expected_updated_at, changes, response_format }): Promise<CallToolResult> => {
    try {
      assertWriteRpcAllowed(client);
      if (changes.stage && !changes.status) throw new Error("Při změně fáze zadejte i status.");
      const updated = await client.update("crm_opportunities", [
        { column: "id", operator: "eq", value: opportunity_id },
        { column: "updated_at", operator: "eq", value: expected_updated_at },
        { column: "deleted_at", operator: "is", value: null },
      ], changes);
      return result(response_format, "Obchodní případ aktualizován", one(updated, "Obchodní případ"));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_replace_crm_opportunity_items", {
    title: "Nahradit rozpočet CRM případu", description: "Atomicky nahradí celý seznam položek obchodního případu. Prázdné pole smaže všechny položky. Před zápisem načtěte detail a potvrďte celý výsledný seznam.",
    inputSchema: z.object({ opportunity_id: uuidSchema, items: z.array(item).max(300), sync_documents: z.boolean().default(true), confirm_replace: z.literal(true), response_format: responseFormatSchema }).strict(), annotations: destructive,
  }, async ({ opportunity_id, items, sync_documents, response_format }): Promise<CallToolResult> => {
    try {
      assertWriteRpcAllowed(client);
      const saved = await client.rpc("replace_crm_opportunity_items", { p_opportunity_id: opportunity_id, p_items: items, p_sync_documents: sync_documents });
      return result(response_format, "Položky CRM případu nahrazeny", saved);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_save_crm_activity", {
    title: "Vytvořit nebo upravit CRM aktivitu", description: "Zapisuje hovor, schůzku, e-mail, úkol či poznámku. Neodesílá e-mail ani kalendářovou pozvánku; calendar_sync_enabled zůstává vypnuté. U úpravy vyžaduje updated_at.",
    inputSchema: z.object({ opportunity_id: uuidSchema, activity_id: uuidSchema.optional(), expected_updated_at: timestamp.optional(), activity: activityFields, response_format: responseFormatSchema }).strict(), annotations: write,
  }, async ({ opportunity_id, activity_id, expected_updated_at, activity, response_format }): Promise<CallToolResult> => {
    try {
      assertWriteRpcAllowed(client);
      if (activity.ends_at && activity.starts_at && Date.parse(activity.ends_at) <= Date.parse(activity.starts_at)) throw new Error("Konec aktivity musí být po začátku.");
      if (activity_id && !expected_updated_at) throw new Error("Při úpravě aktivity zadejte expected_updated_at.");
      const opportunity = await lookup(client, "crm_opportunities", opportunity_id, "id,subject_id,project_id,deleted_at");
      if (opportunity.deleted_at) throw new Error("Smazaný případ nelze upravit.");
      const existing = activity_id ? await lookup(client, "crm_activities", activity_id, "id,opportunity_id,completed_at") : null;
      if (existing && existing.opportunity_id !== opportunity_id) throw new Error("Aktivita nepatří do zadaného případu.");
      const values: Row = { ...activity, opportunity_id, subject_id: opportunity.subject_id, project_id: opportunity.project_id ?? null,
        due_at: activity.starts_at ?? null, completed_at: activity.status === "completed" ? existing?.completed_at ?? new Date().toISOString() : null,
        calendar_sync_enabled: false };
      const rows = activity_id
        ? await client.update("crm_activities", [{ column: "id", operator: "eq", value: activity_id }, { column: "opportunity_id", operator: "eq", value: opportunity_id }, { column: "updated_at", operator: "eq", value: expected_updated_at! }], values)
        : await client.insert("crm_activities", values);
      return result(response_format, "CRM aktivita uložena", one(rows, "Aktivita"));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_add_crm_note", {
    title: "Přidat poznámku do CRM", description: "Přidá novou poznámku k obchodnímu případu. Před opakováním po chybě ověřte detail.",
    inputSchema: z.object({ opportunity_id: uuidSchema, body: z.string().trim().min(1).max(20000), response_format: responseFormatSchema }).strict(), annotations: write,
  }, async ({ opportunity_id, body, response_format }): Promise<CallToolResult> => {
    try {
      assertWriteRpcAllowed(client);
      const opportunity = await lookup(client, "crm_opportunities", opportunity_id, "id,subject_id,deleted_at");
      if (opportunity.deleted_at) throw new Error("Smazaný případ nelze upravit.");
      const created = one(await client.insert("crm_notes", { opportunity_id, subject_id: opportunity.subject_id, body }), "Poznámka");
      return result(response_format, "CRM poznámka přidána", created);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_add_crm_participant", {
    title: "Přidat účastníka CRM případu", description: "Přidá kontakt, firmu nebo zaměstnance mezi účastníky obchodního případu.",
    inputSchema: z.object({ opportunity_id: uuidSchema, participant: z.object({ name: z.string().trim().min(2).max(200), role: participantRole.default("stakeholder"), subject_id: nullableId.optional(), member_id: nullableId.optional(), organization: nullableText.optional(), email: z.email().nullable().optional(), phone: nullableText.optional(), notes: nullableText.optional(), is_primary: z.boolean().default(false) }).strict(), response_format: responseFormatSchema }).strict(), annotations: write,
  }, async ({ opportunity_id, participant, response_format }): Promise<CallToolResult> => {
    try {
      assertWriteRpcAllowed(client);
      const opportunity = await lookup(client, "crm_opportunities", opportunity_id, "id,deleted_at");
      if (opportunity.deleted_at) throw new Error("Smazaný případ nelze upravit.");
      const created = one(await client.insert("crm_opportunity_participants", { ...participant, opportunity_id }), "Účastník");
      return result(response_format, "Účastník přidán", created);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_remove_crm_participant", {
    title: "Odebrat účastníka CRM případu", description: "Trvale odstraní vazbu účastníka na případ, nikoli samotný kontakt/subjekt. Vyžaduje výslovné potvrzení.",
    inputSchema: z.object({ opportunity_id: uuidSchema, participant_id: uuidSchema, confirm: z.literal(true), response_format: responseFormatSchema }).strict(), annotations: destructive,
  }, async ({ opportunity_id, participant_id, response_format }): Promise<CallToolResult> => {
    try {
      assertWriteRpcAllowed(client);
      const deleted = await client.delete("crm_opportunity_participants", [{ column: "id", operator: "eq", value: participant_id }, { column: "opportunity_id", operator: "eq", value: opportunity_id }]);
      return result(response_format, "Účastník odebrán", one(deleted, "Účastník"));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_create_crm_document_draft", {
    title: "Založit koncept nabídky nebo objednávky", description: "Atomicky vytvoří koncept obchodního dokumentu k případu a zkopíruje jeho položky. Nic neodesílá zákazníkovi.",
    inputSchema: z.object({ opportunity_id: uuidSchema, type: z.enum(["offer", "order"]), notes: nullableText.optional(), response_format: responseFormatSchema }).strict(), annotations: write,
  }, async ({ opportunity_id, type, notes, response_format }): Promise<CallToolResult> => {
    try {
      assertWriteRpcAllowed(client);
      const created = asRow(await client.rpc("create_crm_commercial_document_atomic", { p_opportunity_id: opportunity_id, p_type: type, p_notes: notes ?? null }), "create_crm_commercial_document_atomic");
      return result(response_format, "Koncept obchodního dokumentu založen", created);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_save_crm_document_draft", {
    title: "Uložit koncept nabídky nebo objednávky", description: "Atomicky uloží celý koncept a celý seznam položek. Při sync_items=true přepíše položky případu a synchronizovaných konceptů. Neodesílá zákazníkovi.",
    inputSchema: z.object({ document_id: uuidSchema, document: z.object({ title: z.string().trim().min(1).max(500), issue_date: date, valid_until: date.nullable().optional(), notes: nullableText.optional(), subject_id: nullableId.optional() }).strict(), items: z.array(item).max(300), sync_items: z.boolean(), confirm_replace: z.literal(true), response_format: responseFormatSchema }).strict(), annotations: destructive,
  }, async ({ document_id, document, items, sync_items, response_format }): Promise<CallToolResult> => {
    try {
      assertWriteRpcAllowed(client);
      const saved = asRow(await client.rpc("save_crm_commercial_document_draft", { p_document_id: document_id, p_document: document, p_items: items, p_sync_items: sync_items }), "save_crm_commercial_document_draft");
      return result(response_format, "Koncept obchodního dokumentu uložen", saved);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("ekv_portal_accept_crm_offer", {
    title: "Potvrdit přijetí CRM nabídky", description: "Po doloženém souhlasu zákazníka označí již odeslanou nabídku jako přijatou a atomicky vytvoří objednávku. Vyžaduje číslo nabídky a výslovné potvrzení; nic neposílá zákazníkovi.",
    inputSchema: z.object({ offer_id: uuidSchema, expected_number: z.string().trim().min(1).max(100), response_note: nullableText.optional(), confirm_acceptance: z.literal(true), response_format: responseFormatSchema }).strict(), annotations: destructive,
  }, async ({ offer_id, expected_number, response_note, response_format }): Promise<CallToolResult> => {
    try {
      assertWriteRpcAllowed(client);
      const offer = await lookup(client, "crm_commercial_documents", offer_id, "id,number,type,status,deleted_at");
      if (offer.type !== "offer" || offer.status !== "sent" || offer.deleted_at) throw new Error("Přijmout lze pouze aktivní odeslanou nabídku.");
      if (offer.number !== expected_number) throw new Error("Číslo nabídky se neshoduje; načtěte aktuální detail.");
      const accepted = await client.rpc("accept_crm_offer", { p_offer_id: offer_id, p_response_note: response_note ?? null, p_external: false });
      return result(response_format, "Nabídka přijata a objednávka založena", accepted);
    } catch (error) { return errorResult(error); }
  });
}
