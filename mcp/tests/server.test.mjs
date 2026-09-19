import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("stdio server dokončí MCP handshake, zveřejní nástroje a obslouží workflow", async () => {
  const api = createServer((request, response) => {
    if (request.url?.startsWith("/rest/v1/projects")) {
      response.writeHead(200, { "content-type": "application/json", "content-range": "0-0/1" });
      response.end(JSON.stringify([{
        id: "00000000-0000-4000-8000-000000000001",
        name: "FVE Test",
        code: "PR-26-001",
        status: "active",
        type: "FVE",
        start_date: "2026-01-10",
        completion_date: "2026-03-30",
        is_priority: true,
      }]));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise(resolveListen => api.listen(0, "127.0.0.1", resolveListen));
  const address = api.address();
  assert.ok(address && typeof address === "object");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/index.js")],
    env: {
      ...process.env,
      EKV_PORTAL_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
      EKV_PORTAL_SUPABASE_ANON_KEY: "test-anon-key",
      EKV_PORTAL_ENABLE_WRITES: "false",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "ekv-portal-mcp-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.deepEqual(result.tools.map(tool => tool.name).sort(), [
      "ekv_portal_get_finance_overview",
      "ekv_portal_get_gantt_plan",
      "ekv_portal_get_project_finances",
      "ekv_portal_get_project_workspace",
      "ekv_portal_get_realization_finances",
      "ekv_portal_health",
      "ekv_portal_list_crm_opportunities",
      "ekv_portal_list_meeting_notes",
      "ekv_portal_list_planning_tasks",
      "ekv_portal_list_projects",
      "ekv_portal_list_service_cases",
      "ekv_portal_search",
    ]);
    assert.ok(result.tools.every(tool => tool.annotations?.readOnlyHint === true));
    const call = await client.callTool({
      name: "ekv_portal_list_projects",
      arguments: { search: "FVE", response_format: "json", limit: 10, offset: 0 },
    });
    assert.notEqual(call.isError, true);
    const text = call.content.find(block => block.type === "text")?.text;
    assert.ok(text);
    const payload = JSON.parse(text);
    assert.equal(payload.total, 1);
    assert.equal(payload.projects[0].code, "PR-26-001");
  } finally {
    await client.close();
    await new Promise((resolveClose, rejectClose) => api.close(error => error ? rejectClose(error) : resolveClose()));
  }
});

test("zápisový režim zveřejní řízené nástroje a založí plán přes uživatelské JWT", async () => {
  const planId = "00000000-0000-4000-8000-000000000099";
  const itemId = "00000000-0000-4000-8000-000000000088";
  const noteId = "00000000-0000-4000-8000-000000000077";
  let authorization = "";
  const api = createServer((request, response) => {
    authorization = request.headers.authorization ?? "";
    if (request.url === "/rest/v1/rpc/ensure_planning_plan" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(planId));
      return;
    }
    if (request.url === "/rest/v1/rpc/save_planning_item_with_resources" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(itemId));
      return;
    }
    if (request.url?.startsWith("/rest/v1/planning_items?") && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify([{ id: itemId, plan_id: planId, item_type: "task", name: "Kontrola rozvaděče", status: "planned" }]));
      return;
    }
    if (request.url === "/rest/v1/rpc/save_meeting_note" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: noteId, plan_id: planId, title: "KD 1", version: 1, points: [{ kind: "information", text: "Kontrola rozvaděče" }] }));
      return;
    }
    if (request.url === "/rest/v1/rpc/create_meeting_point_task" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: noteId, plan_id: planId, title: "KD 1", version: 2, points: [{ kind: "task", text: "Kontrola rozvaděče", planning_item_id: itemId }] }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise(resolveListen => api.listen(0, "127.0.0.1", resolveListen));
  const address = api.address();
  assert.ok(address && typeof address === "object");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/index.js")],
    env: {
      ...process.env,
      EKV_PORTAL_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
      EKV_PORTAL_SUPABASE_ANON_KEY: "test-anon-key",
      EKV_PORTAL_SUPABASE_ACCESS_TOKEN: "test-user-jwt",
      EKV_PORTAL_ENABLE_WRITES: "true",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "ekv-portal-mcp-write-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    const byName = new Map(result.tools.map(tool => [tool.name, tool]));
    for (const name of [
      "ekv_portal_ensure_gantt_plan",
      "ekv_portal_save_gantt_item",
      "ekv_portal_quick_update_gantt_item",
      "ekv_portal_save_gantt_dependency",
      "ekv_portal_delete_gantt_item",
      "ekv_portal_save_meeting_note",
      "ekv_portal_create_task_from_meeting_point",
      "ekv_portal_save_travel_segment",
      "ekv_portal_save_accommodation",
    ]) assert.ok(byName.has(name), `chybí nástroj ${name}`);
    assert.equal(byName.get("ekv_portal_delete_gantt_item")?.annotations?.destructiveHint, true);
    assert.equal(byName.get("ekv_portal_save_gantt_item")?.annotations?.readOnlyHint, false);
    const call = await client.callTool({
      name: "ekv_portal_ensure_gantt_plan",
      arguments: { entity_type: "project", entity_id: "00000000-0000-4000-8000-000000000001", response_format: "json" },
    });
    assert.notEqual(call.isError, true);
    const text = call.content.find(block => block.type === "text")?.text;
    assert.ok(text);
    assert.equal(JSON.parse(text).plan_id, planId);
    assert.equal(authorization, "Bearer test-user-jwt");

    const savedItem = await client.callTool({
      name: "ekv_portal_save_gantt_item",
      arguments: { plan_id: planId, name: "Kontrola rozvaděče", start_at: "2026-09-20T08:00", end_at: "2026-09-20T17:00", response_format: "json" },
    });
    assert.notEqual(savedItem.isError, true);
    const savedItemText = savedItem.content.find(block => block.type === "text")?.text;
    assert.ok(savedItemText);
    assert.equal(JSON.parse(savedItemText).item.id, itemId);

    const savedNote = await client.callTool({
      name: "ekv_portal_save_meeting_note",
      arguments: { plan_id: planId, note_id: noteId, version: 0, title: "KD 1", meeting_date: "2026-09-19", participants: "Stavbyvedoucí", points: [{ kind: "information", text: "Kontrola rozvaděče" }], response_format: "json" },
    });
    assert.notEqual(savedNote.isError, true);
    const savedNoteText = savedNote.content.find(block => block.type === "text")?.text;
    assert.ok(savedNoteText);
    assert.equal(JSON.parse(savedNoteText).note.version, 1);

    const taskFromPoint = await client.callTool({
      name: "ekv_portal_create_task_from_meeting_point",
      arguments: { note_id: noteId, version: 1, point_index: 0, name: "Kontrola rozvaděče", due_date: "2026-10-01", member_id: "00000000-0000-4000-8000-000000000066", response_format: "json" },
    });
    assert.notEqual(taskFromPoint.isError, true);
    const taskText = taskFromPoint.content.find(block => block.type === "text")?.text;
    assert.ok(taskText);
    assert.equal(JSON.parse(taskText).note.points[0].planning_item_id, itemId);
  } finally {
    await client.close();
    await new Promise((resolveClose, rejectClose) => api.close(error => error ? rejectClose(error) : resolveClose()));
  }
});
