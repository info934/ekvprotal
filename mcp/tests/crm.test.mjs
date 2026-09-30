import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const opportunityId = "00000000-0000-4000-8000-000000000011";
const subjectId = "00000000-0000-4000-8000-000000000022";
const documentId = "00000000-0000-4000-8000-000000000033";
const updatedAt = "2026-09-30T10:00:00+00:00";

async function fixture(writes, run) {
  const calls = [];
  const api = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    const url = new URL(request.url, "http://localhost");
    calls.push({ path: url.pathname, method: request.method, body, authorization: request.headers.authorization });
    let value = [];
    if (url.pathname.endsWith("/rpc/allocate_crm_number")) value = "OP-26-001";
    else if (url.pathname.endsWith("/rpc/replace_crm_opportunity_items")) value = { opportunity_id: opportunityId, total: 500 };
    else if (url.pathname.endsWith("/rpc/create_crm_commercial_document_atomic")) value = { id: documentId, type: "offer", status: "draft" };
    else if (url.pathname.endsWith("/rpc/accept_crm_offer")) value = { offer: { id: documentId, status: "accepted" }, order: { id: opportunityId, status: "draft" } };
    else if (url.pathname.endsWith("/crm_commercial_documents")) value = [{ id: documentId, number: "NAB-26-001", type: "offer", status: "sent", deleted_at: null }];
    else if (url.pathname.endsWith("/crm_opportunities")) {
      const row = { id: opportunityId, title: "FVE", subject_id: subjectId, project_id: null, updated_at: updatedAt, deleted_at: null };
      value = request.method === "GET" && url.searchParams.has("deleted_at") ? [] : [row];
    } else if (url.pathname.endsWith("/crm_activities") && request.method === "POST") value = [{ id: documentId, ...body }];
    else if (url.pathname.endsWith("/crm_notes") && request.method === "POST") value = [{ id: documentId, ...body }];
    else if (url.pathname.endsWith("/crm_opportunity_participants") && request.method === "POST") value = [{ id: documentId, ...body }];
    response.writeHead(200, { "content-type": "application/json", "content-range": "0-0/1" });
    response.end(JSON.stringify(value));
  });
  await new Promise(done => api.listen(0, "127.0.0.1", done));
  const address = api.address();
  assert.ok(address && typeof address === "object");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/index.js")],
    env: { ...process.env, EKV_PORTAL_SUPABASE_URL: `http://127.0.0.1:${address.port}`, EKV_PORTAL_SUPABASE_ANON_KEY: "anon", EKV_PORTAL_SUPABASE_ACCESS_TOKEN: writes ? "user-jwt" : "", EKV_PORTAL_ENABLE_WRITES: String(writes) },
    stderr: "pipe",
  });
  const client = new Client({ name: "crm-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    await run(client, calls);
  } finally {
    await client.close();
    await new Promise((done, fail) => api.close(error => error ? fail(error) : done()));
  }
}

function payload(call) {
  assert.notEqual(call.isError, true, call.content?.find(block => block.type === "text")?.text);
  return JSON.parse(call.content.find(block => block.type === "text").text);
}

test("CRM read tools are visible without write credentials and detail uses fixed tables", async () => {
  await fixture(false, async (client, calls) => {
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some(tool => tool.name === "ekv_portal_get_crm_opportunity" && tool.annotations?.readOnlyHint));
    assert.ok(!tools.some(tool => tool.name === "ekv_portal_create_crm_opportunity"));
    const detail = payload(await client.callTool({ name: "ekv_portal_get_crm_opportunity", arguments: { opportunity_id: opportunityId, response_format: "json" } }));
    assert.equal(detail.opportunity.id, opportunityId);
    assert.deepEqual(detail.items, []);
    assert.ok(calls.some(call => call.path === "/rest/v1/crm_opportunity_events"));
  });
});

test("CRM writes require user JWT, use whitelisted payloads and confirm full replacements", async () => {
  await fixture(true, async (client, calls) => {
    const tools = new Map((await client.listTools()).tools.map(tool => [tool.name, tool]));
    assert.equal(tools.get("ekv_portal_replace_crm_opportunity_items")?.annotations?.destructiveHint, true);
    const created = payload(await client.callTool({ name: "ekv_portal_create_crm_opportunity", arguments: { opportunity: { title: "FVE", subject_id: subjectId }, response_format: "json" } }));
    assert.equal(created.id, opportunityId);
    assert.equal(calls.find(call => call.path.endsWith("/rpc/allocate_crm_number"))?.body.p_document_type, "opportunity");
    assert.equal(calls.find(call => call.path.endsWith("/crm_opportunities") && call.method === "POST")?.body.number, "OP-26-001");

    const updated = payload(await client.callTool({ name: "ekv_portal_update_crm_opportunity", arguments: { opportunity_id: opportunityId, expected_updated_at: updatedAt, changes: { next_step: "Zavolat klientovi" }, response_format: "json" } }));
    assert.equal(updated.id, opportunityId);
    const patch = calls.find(call => call.path.endsWith("/crm_opportunities") && call.method === "PATCH");
    assert.deepEqual(patch.body, { next_step: "Zavolat klientovi" });

    const missingConfirmation = await client.callTool({ name: "ekv_portal_replace_crm_opportunity_items", arguments: { opportunity_id: opportunityId, items: [], response_format: "json" } });
    assert.equal(missingConfirmation.isError, true);
    assert.ok(!calls.some(call => call.path.endsWith("/rpc/replace_crm_opportunity_items")));
    payload(await client.callTool({ name: "ekv_portal_replace_crm_opportunity_items", arguments: { opportunity_id: opportunityId, items: [{ name: "Panely", quantity: 2, unit: "ks", unit_price: 250, unit_cost: 100 }], confirm_replace: true, response_format: "json" } }));
    const replace = calls.find(call => call.path.endsWith("/rpc/replace_crm_opportunity_items"));
    assert.equal(replace.body.p_items[0].unit_cost, 100);

    payload(await client.callTool({ name: "ekv_portal_save_crm_activity", arguments: { opportunity_id: opportunityId, activity: { title: "Zavolat", type: "call", status: "planned" }, response_format: "json" } }));
    assert.equal(calls.find(call => call.path.endsWith("/crm_activities") && call.method === "POST")?.body.calendar_sync_enabled, false);
    payload(await client.callTool({ name: "ekv_portal_create_crm_document_draft", arguments: { opportunity_id: opportunityId, type: "offer", response_format: "json" } }));
    assert.equal(calls.find(call => call.path.endsWith("/rpc/create_crm_commercial_document_atomic"))?.body.p_type, "offer");
    const noAcceptance = await client.callTool({ name: "ekv_portal_accept_crm_offer", arguments: { offer_id: documentId, expected_number: "NAB-26-001", response_format: "json" } });
    assert.equal(noAcceptance.isError, true);
    assert.ok(!calls.some(call => call.path.endsWith("/rpc/accept_crm_offer")));
    payload(await client.callTool({ name: "ekv_portal_accept_crm_offer", arguments: { offer_id: documentId, expected_number: "NAB-26-001", confirm_acceptance: true, response_format: "json" } }));
    assert.equal(calls.find(call => call.path.endsWith("/rpc/accept_crm_offer"))?.body.p_external, false);
    assert.ok(calls.every(call => call.authorization === "Bearer user-jwt"));
  });
});
