import { resolve } from "node:path";

const developmentDefault = resolve(".local-data");

export function getDataDirectory(): string {
  return resolve(process.env.SEQUENT_DATA_DIR ?? developmentDefault);
}

export function useSecureCookies(): boolean {
  if (process.env.SEQUENT_SECURE_COOKIES === "false") return false;
  return process.env.NODE_ENV === "production";
}

export const SESSION_COOKIE = "sequent_session";
export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
