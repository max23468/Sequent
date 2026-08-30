const italianDate = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const italianDecimal = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

export function formatItalianDate(value: string): string {
  return italianDate.format(new Date(value));
}

export function formatMegabytes(bytes: number): string {
  return `${italianDecimal.format(bytes / 1024 / 1024)} MB`;
}

export function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Non indicato";
  return typeof value === "string" ? value : JSON.stringify(value);
}
