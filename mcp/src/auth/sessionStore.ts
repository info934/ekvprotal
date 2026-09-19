import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface StoredSupabaseSession {
  version: 1;
  supabaseUrl: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId?: string | undefined;
  email?: string | undefined;
}

interface SessionEnvelope {
  version: 1;
  protection: "dpapi-current-user" | "file-permissions";
  payload: string;
}

const DPAPI_PROTECT_SCRIPT = [
  "Add-Type -AssemblyName System.Security",
  "$raw=[Console]::In.ReadToEnd()",
  "$bytes=[Text.Encoding]::UTF8.GetBytes($raw)",
  "$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($protected))",
].join(";");

const DPAPI_UNPROTECT_SCRIPT = [
  "Add-Type -AssemblyName System.Security",
  "$raw=[Console]::In.ReadToEnd()",
  "$bytes=[Convert]::FromBase64String($raw)",
  "$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))",
].join(";");

export function defaultSessionFilePath(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA?.trim() || join(homedir(), "AppData", "Local");
    return join(base, "EKV Portal MCP", "session.json");
  }
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "ekv-portal-mcp", "session.json");
}

export function resolveSessionFilePath(value?: string | null): string {
  const candidate = value?.trim();
  if (!candidate) return defaultSessionFilePath();
  return isAbsolute(candidate) ? candidate : resolve(candidate);
}

export async function sessionFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isStoredSession(value: unknown): value is StoredSupabaseSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.version === 1
    && typeof item.supabaseUrl === "string"
    && typeof item.accessToken === "string"
    && typeof item.refreshToken === "string"
    && typeof item.expiresAt === "number"
    && Number.isFinite(item.expiresAt)
    && (item.userId === undefined || typeof item.userId === "string")
    && (item.email === undefined || typeof item.email === "string");
}

function isSessionEnvelope(value: unknown): value is SessionEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.version === 1
    && (item.protection === "dpapi-current-user" || item.protection === "file-permissions")
    && typeof item.payload === "string";
}

async function runPowerShell(script: string, stdin: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", () => rejectPromise(new Error("Windows DPAPI není dostupné; relaci agenta nelze bezpečně načíst.")));
    child.once("close", code => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        rejectPromise(new Error(`Windows DPAPI operace selhala${detail ? `: ${detail.slice(0, 300)}` : "."}`));
        return;
      }
      resolvePromise(Buffer.concat(stdout).toString("utf8").trim());
    });
    child.stdin.end(stdin, "utf8");
  });
}

async function protectSession(serialized: string): Promise<SessionEnvelope> {
  if (process.platform === "win32") {
    return { version: 1, protection: "dpapi-current-user", payload: await runPowerShell(DPAPI_PROTECT_SCRIPT, serialized) };
  }
  return { version: 1, protection: "file-permissions", payload: Buffer.from(serialized, "utf8").toString("base64") };
}

async function unprotectSession(envelope: SessionEnvelope): Promise<string> {
  if (envelope.protection === "dpapi-current-user") {
    if (process.platform !== "win32") throw new Error("Relace je chráněná Windows DPAPI a na tomto systému ji nelze otevřít.");
    return runPowerShell(DPAPI_UNPROTECT_SCRIPT, envelope.payload);
  }
  return Buffer.from(envelope.payload, "base64").toString("utf8");
}

export async function readStoredSession(filePath: string): Promise<StoredSupabaseSession | null> {
  if (!await sessionFileExists(filePath)) return null;
  let envelopeValue: unknown;
  try {
    envelopeValue = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw new Error(`Soubor relace ${filePath} nelze přečíst. Spusťte znovu příkaz auth:login.`);
  }
  if (!isSessionEnvelope(envelopeValue)) throw new Error(`Soubor relace ${filePath} má neplatný formát.`);
  let sessionValue: unknown;
  try {
    sessionValue = JSON.parse(await unprotectSession(envelopeValue)) as unknown;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Uloženou relaci nelze dešifrovat.");
  }
  if (!isStoredSession(sessionValue)) throw new Error("Uložená relace má neplatný nebo neúplný obsah.");
  return sessionValue;
}

export async function writeStoredSession(filePath: string, session: StoredSupabaseSession): Promise<void> {
  const envelope = await protectSession(JSON.stringify(session));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(filePath, 0o600);
}

export async function removeStoredSession(filePath: string): Promise<boolean> {
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
