#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { loadSupabaseConfig, SupabaseRestClient } from "./services/supabaseRest.js";
import { registerFinanceTools } from "./tools/financeTools.js";
import { registerCrmTools } from "./tools/crmTools.js";
import { registerGanttReadTools } from "./tools/ganttReadTools.js";
import { registerPortalTools } from "./tools/registerTools.js";
import { registerWriteTools } from "./tools/writeTools.js";

async function main(): Promise<void> {
  const config = loadSupabaseConfig();
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const client = new SupabaseRestClient(config);
  await client.initialize();
  registerPortalTools(server, client);
  registerCrmTools(server, client);
  registerGanttReadTools(server, client);
  registerFinanceTools(server, client);
  registerWriteTools(server, client);
  await server.connect(new StdioServerTransport());
  console.error(`${SERVER_NAME} ${SERVER_VERSION} běží přes stdio (${config.authMode}, zápisy ${config.writesEnabled ? "zapnuté" : "vypnuté"}).`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`EKV Portal MCP se nepodařilo spustit: ${message}`);
  process.exitCode = 1;
});
