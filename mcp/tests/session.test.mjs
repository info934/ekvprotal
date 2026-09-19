import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readStoredSession, removeStoredSession, writeStoredSession } from "../dist/auth/sessionStore.js";
import { loadSupabaseConfig, SupabaseRestClient } from "../dist/services/supabaseRest.js";
import { loginWithPassword, SupabaseSessionManager } from "../dist/services/supabaseSession.js";

async function temporarySessionFile() {
  const directory = await mkdtemp(join(tmpdir(), "ekv-mcp-session-test-"));
  return { directory, file: join(directory, "session.json") };
}

test("uložená relace se bezpečně zapíše, načte a odstraní", async () => {
  const target = await temporarySessionFile();
  try {
    const session = {
      version: 1,
      supabaseUrl: "https://example.supabase.co",
      accessToken: "test-access-token-with-sufficient-length",
      refreshToken: "test-refresh-token",
      expiresAt: 2_000_000_000,
      userId: "00000000-0000-4000-8000-000000000001",
      email: "agent@example.cz",
    };
    await writeStoredSession(target.file, session);
    assert.deepEqual(await readStoredSession(target.file), session);
    assert.equal(await removeStoredSession(target.file), true);
    assert.equal(await readStoredSession(target.file), null);
  } finally {
    await rm(target.directory, { recursive: true, force: true });
  }
});

test("session manager obnoví expirovaný JWT jen jednou a uloží rotovaný refresh token", async () => {
  const target = await temporarySessionFile();
  const previousFetch = globalThis.fetch;
  let refreshCalls = 0;
  try {
    await writeStoredSession(target.file, {
      version: 1,
      supabaseUrl: "https://example.supabase.co",
      accessToken: "expired-access-token-with-sufficient-length",
      refreshToken: "old-refresh-token",
      expiresAt: 1,
      email: "agent@example.cz",
    });
    globalThis.fetch = async (url, init) => {
      refreshCalls += 1;
      assert.equal(String(url), "https://example.supabase.co/auth/v1/token?grant_type=refresh_token");
      assert.deepEqual(JSON.parse(init.body), { refresh_token: "old-refresh-token" });
      return new Response(JSON.stringify({
        access_token: "new-access-token-with-sufficient-length",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
        user: { id: "00000000-0000-4000-8000-000000000001", email: "agent@example.cz" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const manager = new SupabaseSessionManager({ url: "https://example.supabase.co", apiKey: "anon", sessionFile: target.file, timeoutMs: 1_000 });
    const tokens = await Promise.all([manager.getAccessToken(), manager.getAccessToken(), manager.getAccessToken()]);
    assert.deepEqual(tokens, Array(3).fill("new-access-token-with-sufficient-length"));
    assert.equal(refreshCalls, 1);
    const persisted = await readStoredSession(target.file);
    assert.equal(persisted.refreshToken, "rotated-refresh-token");
  } finally {
    globalThis.fetch = previousFetch;
    await rm(target.directory, { recursive: true, force: true });
  }
});

test("REST klient po 401 automaticky obnoví relaci a zopakuje dotaz", async () => {
  const target = await temporarySessionFile();
  const previousFetch = globalThis.fetch;
  const authorizations = [];
  try {
    await writeStoredSession(target.file, {
      version: 1,
      supabaseUrl: "https://example.supabase.co",
      accessToken: "old-access-token-with-sufficient-length",
      refreshToken: "old-refresh-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    globalThis.fetch = async (url, init) => {
      const targetUrl = String(url);
      if (targetUrl.includes("/auth/v1/token")) {
        return new Response(JSON.stringify({ access_token: "renewed-access-token-with-sufficient-length", refresh_token: "rotated-refresh-token", expires_in: 3600 }), { status: 200 });
      }
      authorizations.push(new Headers(init.headers).get("authorization"));
      if (authorizations.length === 1) return new Response(JSON.stringify({ message: "expired" }), { status: 401 });
      return new Response(JSON.stringify([{ id: "1" }]), { status: 200, headers: { "content-range": "0-0/1" } });
    };
    const client = new SupabaseRestClient({
      url: "https://example.supabase.co",
      apiKey: "anon",
      accessToken: "anon",
      refreshToken: null,
      sessionFile: target.file,
      authMode: "user_session",
      timeoutMs: 1_000,
      writesEnabled: true,
      allowServiceRoleFinance: false,
    });
    const result = await client.query("projects", { select: "id" });
    assert.deepEqual(result.rows, [{ id: "1" }]);
    assert.deepEqual(authorizations, ["Bearer old-access-token-with-sufficient-length", "Bearer renewed-access-token-with-sufficient-length"]);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(target.directory, { recursive: true, force: true });
  }
});

test("jednorázové přihlášení uloží relaci, ale nikdy heslo", async () => {
  const target = await temporarySessionFile();
  const previousFetch = globalThis.fetch;
  let requestBody;
  try {
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        access_token: "login-access-token-with-sufficient-length",
        refresh_token: "login-refresh-token",
        expires_in: 3600,
        user: { id: "00000000-0000-4000-8000-000000000001", email: "agent@example.cz" },
      }), { status: 200 });
    };
    await loginWithPassword({
      url: "https://example.supabase.co",
      apiKey: "anon",
      email: "agent@example.cz",
      password: "temporary-password",
      sessionFile: target.file,
      timeoutMs: 1_000,
    });
    assert.deepEqual(requestBody, { email: "agent@example.cz", password: "temporary-password" });
    const session = await readStoredSession(target.file);
    assert.equal(session.email, "agent@example.cz");
    assert.equal(JSON.stringify(session).includes("temporary-password"), false);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(target.directory, { recursive: true, force: true });
  }
});

test("konfigurace zápisového režimu přijme uloženou relaci bez ručního access tokenu", async () => {
  const target = await temporarySessionFile();
  const names = [
    "EKV_PORTAL_SUPABASE_URL",
    "EKV_PORTAL_SUPABASE_ANON_KEY",
    "EKV_PORTAL_SUPABASE_ACCESS_TOKEN",
    "EKV_PORTAL_SUPABASE_REFRESH_TOKEN",
    "EKV_PORTAL_SESSION_FILE",
    "EKV_PORTAL_USE_STORED_SESSION",
    "EKV_PORTAL_ENABLE_WRITES",
  ];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    await writeStoredSession(target.file, {
      version: 1,
      supabaseUrl: "https://example.supabase.co",
      accessToken: "stored-access-token-with-sufficient-length",
      refreshToken: "stored-refresh-token",
      expiresAt: 2_000_000_000,
    });
    process.env.EKV_PORTAL_SUPABASE_URL = "https://example.supabase.co";
    process.env.EKV_PORTAL_SUPABASE_ANON_KEY = "anon";
    delete process.env.EKV_PORTAL_SUPABASE_ACCESS_TOKEN;
    delete process.env.EKV_PORTAL_SUPABASE_REFRESH_TOKEN;
    process.env.EKV_PORTAL_SESSION_FILE = target.file;
    process.env.EKV_PORTAL_USE_STORED_SESSION = "true";
    process.env.EKV_PORTAL_ENABLE_WRITES = "true";
    const config = loadSupabaseConfig();
    assert.equal(config.authMode, "user_session");
    assert.equal(config.writesEnabled, true);
    assert.equal(config.sessionFile, target.file);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    await rm(target.directory, { recursive: true, force: true });
  }
});
