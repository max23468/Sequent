import { getCanonicalField, type DeclarationSnapshot } from "../../domain/declaration.ts";

export function technicalFieldValue(declaration: DeclarationSnapshot, path: string): string {
  const value = getCanonicalField(declaration, `xsd:${path}`)?.value;
  return value === null || value === undefined ? "" : String(value);
}

export function officialDateToIso(value: string): string | null {
  const match = /^(\d{2})(\d{2})(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function localTodayIso(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
