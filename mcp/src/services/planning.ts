import { SupabaseRequestError, SupabaseRestClient } from "./supabaseRest.js";
import type { Row } from "../types.js";

export type PlanningEntityType = "project" | "realization";

export interface PlanningTarget {
  planId?: string | undefined;
  entityType?: PlanningEntityType | undefined;
  entityId?: string | undefined;
}

export function asRows(value: unknown, label: string): Row[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === "object" && item !== null && !Array.isArray(item))) {
    throw new SupabaseRequestError(`${label} vrátilo neočekávaný formát. Ověřte verzi databázových migrací.`, 502);
  }
  return value as Row[];
}

export function asRow(value: unknown, label: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SupabaseRequestError(`${label} vrátilo neočekávaný formát. Ověřte verzi databázových migrací.`, 502);
  }
  return value as Row;
}

export function asUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new SupabaseRequestError(`${label} nevrátilo platné UUID. Ověřte verzi databázových migrací.`, 502);
  }
  return value;
}

export async function resolvePlanningPlanId(
  client: SupabaseRestClient,
  target: PlanningTarget,
  createIfMissing: boolean,
): Promise<string | null> {
  if (target.planId) return target.planId;
  if (!target.entityType || !target.entityId) {
    throw new Error("Zadejte plan_id, nebo dvojici entity_type a entity_id.");
  }
  if (createIfMissing) {
    return asUuid(await client.rpc("ensure_planning_plan", {
      p_entity_type: target.entityType,
      p_entity_id: target.entityId,
    }), "ensure_planning_plan");
  }
  const column = target.entityType === "project" ? "project_id" : "realization_id";
  const result = await client.query("planning_plans", {
    select: "id",
    filters: [{ column, operator: "eq", value: target.entityId }],
    limit: 1,
    count: false,
  });
  return typeof result.rows[0]?.id === "string" ? result.rows[0].id : null;
}

export function assertWriteRpcAllowed(client: SupabaseRestClient): void {
  if (!client.config.writesEnabled || !["user_access_token", "user_session"].includes(client.config.authMode)) {
    throw new SupabaseRequestError("Zápisové workflow není aktivní. Nastavte EKV_PORTAL_ENABLE_WRITES=true a použijte uloženou uživatelskou relaci nebo dočasný access token.", 403);
  }
}
