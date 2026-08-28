import type { DeclarationSnapshot } from "./declaration.ts";

export interface DerivedFieldContext {
  declarationKind: DeclarationSnapshot["declarationKind"];
  quadroEaTypeCounts: Readonly<Record<string, number>>;
}

export function deriveOfficialFieldValue(
  derivedFrom: string | null | undefined,
  context: DerivedFieldContext,
): string | null {
  if (!derivedFrom) return null;
  if (derivedFrom === "declaration-kind:first")
    return context.declarationKind === "first" ? "1" : "";
  if (derivedFrom === "declaration-kind:substitute")
    return context.declarationKind === "first" ? "" : context.declarationKind.slice(-1);
  const eaType = derivedFrom.match(/^quadro-ea:type:(\d+)$/)?.[1];
  if (eaType) return String(context.quadroEaTypeCounts[eaType] ?? 0);
  throw new Error(`DERIVED_FIELD_SOURCE_UNKNOWN:${derivedFrom}`);
}
