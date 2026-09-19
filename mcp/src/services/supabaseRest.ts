import { existsSync } from "node:fs";
import { DEFAULT_TIMEOUT_MS } from "../constants.js";
import { resolveSessionFilePath } from "../auth/sessionStore.js";
import { SupabaseSessionManager } from "./supabaseSession.js";
import type { QueryFilter, QueryOptions, QueryResult, Row } from "../types.js";

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/i;

export interface SupabaseConfig {
  url: string;
  apiKey: string;
  accessToken: string;
  refreshToken: string | null;
  sessionFile: string | null;
  authMode: "user_access_token" | "user_session" | "service_role" | "api_key";
  timeoutMs: number;
  writesEnabled: boolean;
  allowServiceRoleFinance: boolean;
}

export class SupabaseRequestError extends Error {
  public readonly status: number;

  public constructor(message: string, status: number) {
    super(message);
    this.name = "SupabaseRequestError";
    this.status = status;
  }
}

function requiredEnvironmentValue(names: readonly string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Chybí proměnná prostředí ${names.join(" nebo ")}. Doplňte ji podle mcp/.env.example.`);
}

function positiveIntegerFromEnvironment(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} musí být kladné celé číslo.`);
  }
  return value;
}

export function loadSupabaseConfig(): SupabaseConfig {
  const url = requiredEnvironmentValue(["EKV_PORTAL_SUPABASE_URL", "VITE_SUPABASE_URL"]).replace(/\/+$/, "");
  const serviceRole = process.env.EKV_PORTAL_SUPABASE_SERVICE_ROLE_KEY?.trim();
  const explicitApiKey = process.env.EKV_PORTAL_SUPABASE_KEY?.trim();
  const anonKey = process.env.EKV_PORTAL_SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim();
  const apiKey = explicitApiKey || anonKey || serviceRole || requiredEnvironmentValue(["EKV_PORTAL_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY", "EKV_PORTAL_SUPABASE_SERVICE_ROLE_KEY"]);
  const usesServiceRole = Boolean(serviceRole && apiKey === serviceRole);
  const userAccessToken = process.env.EKV_PORTAL_SUPABASE_ACCESS_TOKEN?.trim();
  const refreshToken = process.env.EKV_PORTAL_SUPABASE_REFRESH_TOKEN?.trim() || null;
  const requestedWrites = process.env.EKV_PORTAL_ENABLE_WRITES?.trim().toLowerCase() === "true";
  const requestedStoredSession = process.env.EKV_PORTAL_USE_STORED_SESSION?.trim().toLowerCase() === "true";
  const candidateSessionFile = resolveSessionFilePath(process.env.EKV_PORTAL_SESSION_FILE);
  const useStoredSession = !userAccessToken && Boolean(refreshToken || requestedStoredSession || (requestedWrites && existsSync(candidateSessionFile)));
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);

  if (!url.startsWith("https://") && !isLocal) {
    throw new Error("EKV_PORTAL_SUPABASE_URL musí používat HTTPS; HTTP je povoleno jen pro localhost.");
  }
  if (requestedWrites && !userAccessToken && !useStoredSession) {
    throw new Error("Zápisový režim vyžaduje uživatelskou relaci. Spusťte v adresáři mcp `pnpm auth:login`, nebo dočasně nastavte EKV_PORTAL_SUPABASE_ACCESS_TOKEN.");
  }
  if (requestedWrites && usesServiceRole) {
    throw new Error("Pro zápisový režim použijte anon API klíč spolu s uživatelskou relací; service role klíč nesmí být aktivním API klíčem.");
  }

  return {
    url,
    apiKey,
    accessToken: userAccessToken || apiKey,
    refreshToken,
    sessionFile: useStoredSession ? candidateSessionFile : null,
    authMode: userAccessToken ? "user_access_token" : useStoredSession ? "user_session" : usesServiceRole ? "service_role" : "api_key",
    timeoutMs: positiveIntegerFromEnvironment("EKV_PORTAL_REQUEST_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    writesEnabled: requestedWrites,
    allowServiceRoleFinance: process.env.EKV_PORTAL_ALLOW_SERVICE_ROLE_FINANCE?.trim().toLowerCase() === "true",
  };
}

export function sanitizeSearchTerm(value: string): string {
  return value.replace(/[%,_*()\\.\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function assertIdentifier(value: string, kind: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Neplatný ${kind}: ${value}`);
  }
}

function serializeFilter(filter: QueryFilter): string {
  assertIdentifier(filter.column, "název sloupce");
  if (filter.operator === "in") {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      throw new Error(`Filtr ${filter.column}.in vyžaduje neprázdné pole.`);
    }
    const values = filter.value.map(value => String(value).replace(/[(),]/g, "")).join(",");
    return `in.(${values})`;
  }
  const value = filter.value === null ? "null" : String(filter.value);
  return `${filter.operator}.${value}`;
}

export function buildQueryUrl(baseUrl: string, table: string, options: QueryOptions): URL {
  assertIdentifier(table, "název tabulky");
  const url = new URL(`${baseUrl}/rest/v1/${table}`);
  url.searchParams.set("select", options.select);

  for (const filter of options.filters ?? []) {
    url.searchParams.append(filter.column, serializeFilter(filter));
  }
  if (options.or) url.searchParams.set("or", `(${options.or})`);
  if (options.order) url.searchParams.set("order", options.order);
  if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit));
  if (options.offset !== undefined) url.searchParams.set("offset", String(options.offset));
  return url;
}

function parseTotal(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const totalPart = contentRange.split("/")[1];
  if (!totalPart || totalPart === "*") return null;
  const total = Number(totalPart);
  return Number.isFinite(total) ? total : null;
}

function isRowArray(value: unknown): value is Row[] {
  return Array.isArray(value) && value.every(item => typeof item === "object" && item !== null && !Array.isArray(item));
}

function errorMessageForStatus(status: number, detail: string): string {
  if (status === 401) return "Supabase odmítl přihlášení. U uložené relace spusťte `pnpm auth:login`; u dočasného režimu obnovte access token.";
  if (status === 403) return "Supabase odmítl přístup. Uživatel nemá potřebné RLS oprávnění pro tento modul.";
  if (status === 404) return "Požadovaný zdroj v Supabase neexistuje. Zkontrolujte, zda jsou nasazeny aktuální migrace.";
  if (status === 429) return "Supabase omezil počet požadavků. Počkejte chvíli a zkuste menší nebo přesnější dotaz.";
  if (status === 409) return `Zápis koliduje s existujícím záznamem${detail ? `: ${detail}` : "."}`;
  return `Supabase vrátil HTTP ${status}${detail ? `: ${detail}` : "."}`;
}

export class SupabaseRestClient {
  private readonly sessionManager: SupabaseSessionManager | null;

  public constructor(public readonly config: SupabaseConfig) {
    this.sessionManager = config.authMode === "user_session" && config.sessionFile
      ? new SupabaseSessionManager({
        url: config.url,
        apiKey: config.apiKey,
        sessionFile: config.sessionFile,
        timeoutMs: config.timeoutMs,
        ...(config.refreshToken ? { initialRefreshToken: config.refreshToken } : {}),
      })
      : null;
  }

  public async initialize(): Promise<void> {
    if (this.sessionManager) await this.sessionManager.getAccessToken(false);
  }

  public async query(table: string, options: QueryOptions): Promise<QueryResult> {
    const url = buildQueryUrl(this.config.url, table, options);
    let response: Response;

    try {
      response = await this.authorizedFetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(options.count === false ? {} : { Prefer: "count=exact" }),
        },
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new SupabaseRequestError("Dotaz do Supabase vypršel. Zpřesněte filtry nebo zvyšte EKV_PORTAL_REQUEST_TIMEOUT_MS.", 408);
      }
      throw new SupabaseRequestError("K Supabase se nepodařilo připojit. Zkontrolujte URL, síť a dostupnost backendu.", 0);
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof body === "object" && body !== null && "message" in body
        ? String((body as { message?: unknown }).message ?? "")
        : "";
      throw new SupabaseRequestError(errorMessageForStatus(response.status, detail), response.status);
    }
    if (!isRowArray(body)) {
      throw new SupabaseRequestError("Supabase vrátil neočekávaný formát odpovědi.", 502);
    }

    return { rows: body, total: parseTotal(response.headers.get("content-range")) };
  }

  public async rpc(functionName: string, params: Record<string, unknown> = {}): Promise<unknown> {
    assertIdentifier(functionName, "název RPC funkce");
    return this.requestJson(`${this.config.url}/rest/v1/rpc/${functionName}`, "POST", params, false);
  }

  public async insert(table: string, values: Row): Promise<Row[]> {
    this.assertWritesEnabled();
    assertIdentifier(table, "název tabulky");
    const result = await this.requestJson(`${this.config.url}/rest/v1/${table}`, "POST", values, true);
    if (!isRowArray(result)) throw new SupabaseRequestError("Supabase vrátil neočekávaný formát po vložení záznamu.", 502);
    return result;
  }

  public async update(table: string, filters: readonly QueryFilter[], values: Row): Promise<Row[]> {
    this.assertWritesEnabled();
    if (filters.length === 0) throw new SupabaseRequestError("Hromadná aktualizace bez filtru není povolena.", 400);
    const url = buildQueryUrl(this.config.url, table, { select: "*", filters, count: false });
    const result = await this.requestJson(url.toString(), "PATCH", values, true);
    if (!isRowArray(result)) throw new SupabaseRequestError("Supabase vrátil neočekávaný formát po změně záznamu.", 502);
    return result;
  }

  public async delete(table: string, filters: readonly QueryFilter[]): Promise<Row[]> {
    this.assertWritesEnabled();
    if (filters.length === 0) throw new SupabaseRequestError("Hromadné mazání bez filtru není povoleno.", 400);
    const url = buildQueryUrl(this.config.url, table, { select: "*", filters, count: false });
    const result = await this.requestJson(url.toString(), "DELETE", undefined, true);
    if (!isRowArray(result)) throw new SupabaseRequestError("Supabase vrátil neočekávaný formát po odstranění záznamu.", 502);
    return result;
  }

  private assertWritesEnabled(): void {
    if (!this.config.writesEnabled || !["user_access_token", "user_session"].includes(this.config.authMode)) {
      throw new SupabaseRequestError("Zápisy nejsou povoleny. Zapněte EKV_PORTAL_ENABLE_WRITES=true a použijte uloženou uživatelskou relaci nebo dočasný access token.", 403);
    }
  }

  private async authorizedFetch(url: string | URL, init: RequestInit): Promise<Response> {
    const send = async (forceRefresh: boolean, rejectedAccessToken?: string): Promise<{ response: Response; token: string }> => {
      const token = this.sessionManager
        ? await this.sessionManager.getAccessToken(forceRefresh, rejectedAccessToken)
        : this.config.accessToken;
      const headers = new Headers(init.headers);
      headers.set("apikey", this.config.apiKey);
      headers.set("Authorization", `Bearer ${token}`);
      return { response: await fetch(url, { ...init, headers, signal: AbortSignal.timeout(this.config.timeoutMs) }), token };
    };
    let attempt = await send(false);
    if (attempt.response.status === 401 && this.sessionManager) {
      await attempt.response.body?.cancel().catch(() => undefined);
      attempt = await send(true, attempt.token);
    }
    return attempt.response;
  }

  private async requestJson(url: string, method: "POST" | "PATCH" | "DELETE", body: unknown, returnRepresentation: boolean): Promise<unknown> {
    let response: Response;
    try {
      response = await this.authorizedFetch(url, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(returnRepresentation ? { Prefer: "return=representation" } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new SupabaseRequestError("Zápis nebo RPC volání vypršelo. Ověřte výsledek před opakováním, aby nevznikla duplicita.", 408);
      }
      throw new SupabaseRequestError("K Supabase se nepodařilo připojit. Zkontrolujte síť a před opakováním ověřte, zda se zápis neprovedl.", 0);
    }
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try { parsed = JSON.parse(text) as unknown; }
      catch { parsed = text; }
    }
    if (!response.ok) {
      const detail = typeof parsed === "object" && parsed !== null && "message" in parsed
        ? String((parsed as { message?: unknown }).message ?? "")
        : typeof parsed === "string" ? parsed : "";
      throw new SupabaseRequestError(errorMessageForStatus(response.status, detail), response.status);
    }
    return parsed;
  }
}
