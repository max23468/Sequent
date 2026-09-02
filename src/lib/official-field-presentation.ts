export function isOfficialDateType(type: string): boolean {
  return type.endsWith("DatoDT_Type");
}

export function normalizeOfficialDateValue(value: string): string {
  const trimmed = value.trim();
  if (/^0+$/u.test(trimmed)) return "";
  return trimmed.replaceAll(/\D/gu, "").slice(0, 8);
}

export function formatOfficialDateValue(value: string): string {
  const digits = normalizeOfficialDateValue(value);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function formatOfficialChoiceLabel(option: { value: string; label: string }): string {
  const value = option.value.trim();
  const label = option.label.trim();
  if (!value || label === value || label.startsWith(`${value} —`)) return label;
  return `${value} — ${label}`;
}
