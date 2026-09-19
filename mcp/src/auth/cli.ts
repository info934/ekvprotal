#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { DEFAULT_TIMEOUT_MS } from "../constants.js";
import { readStoredSession, resolveSessionFilePath } from "./sessionStore.js";
import { loginWithPassword } from "../services/supabaseSession.js";

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  return value || undefined;
}

function requiredValue(label: string, value: string | undefined): string {
  if (!value) throw new Error(`${label} chybí. Nastavte jej v prostředí nebo předejte jako parametr.`);
  return value;
}

async function promptText(label: string, defaultValue?: string): Promise<string> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const value = (await readline.question(`${label}${suffix}: `)).trim();
    return value || defaultValue || "";
  } finally {
    readline.close();
  }
}

async function promptSecret(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Heslo lze zadat jen v interaktivním terminálu. Nebude uloženo ani vypsáno.");
  }
  stdout.write(`${label}: `);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolvePromise, rejectPromise) => {
    let value = "";
    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk: string | Buffer): void => {
      const text = String(chunk);
      for (const character of text) {
        if (character === "\u0003") {
          cleanup();
          rejectPromise(new Error("Přihlášení bylo zrušeno."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolvePromise(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    };
    stdin.on("data", onData);
  });
}

function connectionValues(): { url: string; apiKey: string; sessionFile: string } {
  const url = requiredValue("Supabase URL", argumentValue("--url") || process.env.EKV_PORTAL_SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()).replace(/\/+$/, "");
  const apiKey = requiredValue("Supabase anon key", argumentValue("--anon-key") || process.env.EKV_PORTAL_SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim());
  if (!url.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) throw new Error("Supabase URL musí používat HTTPS; HTTP je povoleno jen pro localhost.");
  return { url, apiKey, sessionFile: resolveSessionFilePath(argumentValue("--session-file") || process.env.EKV_PORTAL_SESSION_FILE) };
}

function sessionFileValue(): string {
  return resolveSessionFilePath(argumentValue("--session-file") || process.env.EKV_PORTAL_SESSION_FILE);
}

async function login(): Promise<void> {
  const connection = connectionValues();
  const configuredEmail = argumentValue("--email") || process.env.EKV_PORTAL_AGENT_EMAIL?.trim();
  const email = await promptText("E-mail technického uživatele EKV", configuredEmail);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Zadejte platný e-mail technického uživatele.");
  const password = await promptSecret("Heslo (nebude uloženo)");
  if (!password) throw new Error("Heslo nesmí být prázdné.");
  const session = await loginWithPassword({ ...connection, email, password, timeoutMs: DEFAULT_TIMEOUT_MS });
  const expires = new Date(session.expiresAt * 1000).toLocaleString("cs-CZ");
  console.log(`Přihlášení bylo úspěšné pro ${session.email ?? email}.`);
  console.log(`Krátkodobý JWT platí přibližně do ${expires}; MCP jej bude automaticky obnovovat.`);
  console.log(`Relace je uložená v: ${connection.sessionFile}`);
}

async function status(): Promise<void> {
  const sessionFile = sessionFileValue();
  const session = await readStoredSession(sessionFile);
  if (!session) {
    console.log(`Relace agenta není uložená (${sessionFile}).`);
    process.exitCode = 1;
    return;
  }
  console.log(`Uživatel: ${session.email ?? session.userId ?? "neuveden"}`);
  console.log(`Supabase: ${session.supabaseUrl}`);
  console.log(`JWT expirace: ${new Date(session.expiresAt * 1000).toLocaleString("cs-CZ")}`);
  console.log(`Uložiště: ${sessionFile}`);
  console.log("Obnovovací token ani JWT se z bezpečnostních důvodů nevypisují.");
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "status";
  if (command === "login") await login();
  else if (command === "status") await status();
  else throw new Error("Použití: pnpm auth:login nebo pnpm auth:status");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
