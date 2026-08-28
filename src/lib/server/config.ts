import { resolve } from "node:path";

const developmentDefault = resolve(".local-data");
const developmentUsernameDefault = "Sviluppo";
const developmentPasswordDefault = "SequentSviluppoSicuro2026";

export function getDataDirectory(): string {
  return resolve(process.env.SEQUENT_DATA_DIR ?? developmentDefault);
}

export function useSecureCookies(): boolean {
  if (process.env.SEQUENT_SECURE_COOKIES === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function useDevelopmentAutoLogin(isDevelopment: boolean, clientAddress: string): boolean {
  const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
  return (
    isDevelopment &&
    loopbackAddresses.has(clientAddress) &&
    process.env.SEQUENT_DEV_AUTO_LOGIN !== "false"
  );
}

export function getDevelopmentPassword(): string {
  return process.env.SEQUENT_DEV_PASSWORD ?? developmentPasswordDefault;
}

export function getDevelopmentUsername(): string {
  return process.env.SEQUENT_DEV_USERNAME ?? developmentUsernameDefault;
}

export const SESSION_COOKIE = "sequent_session";
export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

export function getCodexModel(): string {
  return process.env.SEQUENT_CODEX_MODEL ?? "gpt-5.6-terra";
}

export function getCodexHome(): string | undefined {
  return process.env.SEQUENT_CODEX_HOME;
}

function featureEnabled(environmentName: string): boolean {
  const configured = process.env[environmentName];
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export function isCodexEnabled(): boolean {
  return featureEnabled("SEQUENT_CODEX_ENABLED");
}

export function isDizEnabled(): boolean {
  return featureEnabled("SEQUENT_DIZ_ENABLED");
}

export function getQualifiedSuccessioniOnLineUrl(): string | null {
  if (!isDizEnabled()) return null;
  const value = process.env.SEQUENT_SUCCESSIONI_ONLINE_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "jnlp:") return null;
    return value;
  } catch {
    return null;
  }
}
