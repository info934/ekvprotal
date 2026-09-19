import { readStoredSession, type StoredSupabaseSession, writeStoredSession } from "../auth/sessionStore.js";

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId?: string | undefined;
  email?: string | undefined;
}

interface SessionManagerOptions {
  url: string;
  apiKey: string;
  sessionFile: string;
  timeoutMs: number;
  initialAccessToken?: string | undefined;
  initialRefreshToken?: string | undefined;
}

const REFRESH_EARLY_SECONDS = 120;

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseAuthResponse(value: unknown): AuthResponse {
  const body = asObject(value);
  const user = asObject(body?.user);
  const accessToken = body?.access_token;
  const refreshToken = body?.refresh_token;
  const expiresAtValue = body?.expires_at;
  const expiresInValue = body?.expires_in;
  const expiresAt = typeof expiresAtValue === "number"
    ? expiresAtValue
    : Math.floor(Date.now() / 1000) + (typeof expiresInValue === "number" ? expiresInValue : 3600);
  if (typeof accessToken !== "string" || accessToken.length < 20 || typeof refreshToken !== "string" || refreshToken.length < 10) {
    throw new Error("Supabase Auth vrátil neúplnou relaci.");
  }
  return {
    accessToken,
    refreshToken,
    expiresAt,
    ...(typeof user?.id === "string" ? { userId: user.id } : {}),
    ...(typeof user?.email === "string" ? { email: user.email } : {}),
  };
}

async function authRequest(url: string, apiKey: string, path: string, body: Record<string, string>, timeoutMs: number): Promise<AuthResponse> {
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new Error("Přihlášení k Supabase Auth vypršelo.");
    throw new Error("K Supabase Auth se nepodařilo připojit.");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const object = asObject(payload);
    const detail = typeof object?.error_description === "string"
      ? object.error_description
      : typeof object?.msg === "string" ? object.msg : typeof object?.message === "string" ? object.message : "přihlášení bylo odmítnuto";
    throw new Error(`Supabase Auth: ${detail}`);
  }
  return parseAuthResponse(payload);
}

function toStoredSession(url: string, response: AuthResponse, previous?: StoredSupabaseSession | null): StoredSupabaseSession {
  return {
    version: 1,
    supabaseUrl: url,
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresAt: response.expiresAt,
    ...(response.userId || previous?.userId ? { userId: response.userId ?? previous?.userId } : {}),
    ...(response.email || previous?.email ? { email: response.email ?? previous?.email } : {}),
  };
}

export async function loginWithPassword(options: {
  url: string;
  apiKey: string;
  email: string;
  password: string;
  sessionFile: string;
  timeoutMs: number;
}): Promise<StoredSupabaseSession> {
  const response = await authRequest(options.url, options.apiKey, "/auth/v1/token?grant_type=password", {
    email: options.email,
    password: options.password,
  }, options.timeoutMs);
  const session = toStoredSession(options.url, response);
  await writeStoredSession(options.sessionFile, session);
  return session;
}

export class SupabaseSessionManager {
  private session: StoredSupabaseSession | null = null;
  private loadPromise: Promise<void> | null = null;
  private refreshPromise: Promise<string> | null = null;

  public constructor(private readonly options: SessionManagerOptions) {}

  public async getAccessToken(forceRefresh = false, rejectedAccessToken?: string): Promise<string> {
    await this.load();
    if (!this.session) throw new Error("Relace agenta nebyla nalezena. V adresáři mcp spusťte `pnpm auth:login`.");
    if (this.session.supabaseUrl.replace(/\/+$/, "") !== this.options.url.replace(/\/+$/, "")) {
      throw new Error("Uložená relace patří jinému Supabase projektu. Spusťte znovu `pnpm auth:login`.");
    }
    const now = Math.floor(Date.now() / 1000);
    if (forceRefresh && rejectedAccessToken && this.session.accessToken !== rejectedAccessToken && this.session.expiresAt > now + REFRESH_EARLY_SECONDS) {
      return this.session.accessToken;
    }
    if (!forceRefresh && this.session.accessToken && this.session.expiresAt > now + REFRESH_EARLY_SECONDS) return this.session.accessToken;
    if (!this.refreshPromise) this.refreshPromise = this.refresh().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  public async getSessionInfo(): Promise<Pick<StoredSupabaseSession, "supabaseUrl" | "expiresAt" | "userId" | "email"> | null> {
    await this.load();
    if (!this.session) return null;
    return {
      supabaseUrl: this.session.supabaseUrl,
      expiresAt: this.session.expiresAt,
      ...(this.session.userId ? { userId: this.session.userId } : {}),
      ...(this.session.email ? { email: this.session.email } : {}),
    };
  }

  private async load(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.loadFromStore();
    return this.loadPromise;
  }

  private async loadFromStore(): Promise<void> {
    this.session = await readStoredSession(this.options.sessionFile);
    if (!this.session && this.options.initialRefreshToken) {
      this.session = {
        version: 1,
        supabaseUrl: this.options.url,
        accessToken: this.options.initialAccessToken ?? "",
        refreshToken: this.options.initialRefreshToken,
        expiresAt: 0,
      };
    }
  }

  private async refresh(): Promise<string> {
    if (!this.session?.refreshToken) throw new Error("Relaci agenta nelze obnovit. Spusťte `pnpm auth:login`.");
    let response: AuthResponse;
    try {
      response = await authRequest(this.options.url, this.options.apiKey, "/auth/v1/token?grant_type=refresh_token", {
        refresh_token: this.session.refreshToken,
      }, this.options.timeoutMs);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "obnovení relace selhalo";
      throw new Error(`${detail}. Přihlaste technického uživatele znovu pomocí \`pnpm auth:login\`.`);
    }
    this.session = toStoredSession(this.options.url, response, this.session);
    await writeStoredSession(this.options.sessionFile, this.session);
    return this.session.accessToken;
  }
}
