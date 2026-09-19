import assert from "node:assert/strict";
import test from "node:test";
import { buildQueryUrl, sanitizeSearchTerm, SupabaseRestClient } from "../dist/services/supabaseRest.js";

test("sanitizeSearchTerm odstraňuje PostgREST řídicí znaky", () => {
  assert.equal(sanitizeSearchTerm("  OP-26_100%,(test)  "), "OP-26 100 test");
});

test("buildQueryUrl sestaví bezpečný stránkovaný dotaz", () => {
  const url = buildQueryUrl("https://example.supabase.co", "projects", {
    select: "id,name,code",
    filters: [{ column: "status", operator: "eq", value: "active" }],
    or: "name.ilike.*FVE*,code.ilike.*FVE*",
    order: "created_at.desc",
    limit: 20,
    offset: 40,
  });
  assert.equal(url.pathname, "/rest/v1/projects");
  assert.equal(url.searchParams.get("status"), "eq.active");
  assert.equal(url.searchParams.get("or"), "(name.ilike.*FVE*,code.ilike.*FVE*)");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("offset"), "40");
});

test("buildQueryUrl odmítne dynamický neplatný název tabulky", () => {
  assert.throws(() => buildQueryUrl("https://example.supabase.co", "projects;drop table", { select: "id" }), /Neplatný název tabulky/);
});

test("SupabaseRestClient vrací řádky a přesný počet", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ id: "1", name: "Projekt" }]), {
    status: 200,
    headers: { "content-type": "application/json", "content-range": "0-0/12" },
  });
  try {
    const client = new SupabaseRestClient({ url: "https://example.supabase.co", apiKey: "anon", accessToken: "jwt", refreshToken: null, sessionFile: null, authMode: "user_access_token", timeoutMs: 1_000, writesEnabled: false, allowServiceRoleFinance: false });
    const result = await client.query("projects", { select: "id,name", limit: 1 });
    assert.equal(result.total, 12);
    assert.deepEqual(result.rows, [{ id: "1", name: "Projekt" }]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("SupabaseRestClient převádí 403 na užitečnou chybu", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "permission denied" }), { status: 403, headers: { "content-type": "application/json" } });
  try {
    const client = new SupabaseRestClient({ url: "https://example.supabase.co", apiKey: "anon", accessToken: "jwt", refreshToken: null, sessionFile: null, authMode: "user_access_token", timeoutMs: 1_000, writesEnabled: false, allowServiceRoleFinance: false });
    await assert.rejects(client.query("projects", { select: "id" }), /RLS oprávnění/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("SupabaseRestClient volá RPC s JSON parametry a JWT", async () => {
  const previousFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify("00000000-0000-4000-8000-000000000123"), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const client = new SupabaseRestClient({ url: "https://example.supabase.co", apiKey: "anon", accessToken: "user-jwt", refreshToken: null, sessionFile: null, authMode: "user_access_token", timeoutMs: 1_000, writesEnabled: true, allowServiceRoleFinance: false });
    const result = await client.rpc("ensure_planning_plan", { p_entity_type: "project", p_entity_id: "00000000-0000-4000-8000-000000000001" });
    assert.equal(result, "00000000-0000-4000-8000-000000000123");
    assert.equal(captured.url, "https://example.supabase.co/rest/v1/rpc/ensure_planning_plan");
    assert.equal(captured.init.method, "POST");
    assert.equal(new Headers(captured.init.headers).get("authorization"), "Bearer user-jwt");
    assert.deepEqual(JSON.parse(captured.init.body), { p_entity_type: "project", p_entity_id: "00000000-0000-4000-8000-000000000001" });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("přímé mutace jsou blokované bez výslovně zapnutých zápisů", async () => {
  const client = new SupabaseRestClient({ url: "https://example.supabase.co", apiKey: "anon", accessToken: "jwt", refreshToken: null, sessionFile: null, authMode: "user_access_token", timeoutMs: 1_000, writesEnabled: false, allowServiceRoleFinance: false });
  await assert.rejects(client.insert("planning_dependencies", { plan_id: "x" }), /Zápisy nejsou povoleny/);
});
