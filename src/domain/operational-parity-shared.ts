import type { DeclarationKind } from "./municipality-conservatory.ts";

export type FieldHandling =
  | "inserito"
  | "derivato"
  | "gestito-automaticamente"
  | "riservato-ufficio"
  | "gestione-contestuale";

export type ConcreteFieldHandling = Exclude<FieldHandling, "gestione-contestuale">;
export type SemanticReviewStatus = "qualificata" | "candidata" | "irrisolta";

export interface OperationalParityHandling {
  handling: FieldHandling | null;
  handlingByDeclarationKind?: Record<DeclarationKind, ConcreteFieldHandling>;
  semanticReview: {
    status: SemanticReviewStatus;
    reason: string;
    blocker: string | null;
  };
}

export function operationalParityHandlingForDeclaration(
  parity: Pick<OperationalParityHandling, "handling" | "handlingByDeclarationKind">,
  declarationKind: DeclarationKind,
): ConcreteFieldHandling | null {
  if (parity.handling !== "gestione-contestuale") return parity.handling;
  return parity.handlingByDeclarationKind?.[declarationKind] ?? null;
}

export function isOperationalParityEditable(
  parity: Pick<
    OperationalParityHandling,
    "handling" | "handlingByDeclarationKind" | "semanticReview"
  >,
  declarationKind?: DeclarationKind,
): boolean {
  const handling = declarationKind
    ? operationalParityHandlingForDeclaration(parity, declarationKind)
    : parity.handling;
  return handling === "inserito" && parity.semanticReview.status === "qualificata";
}

export function isOperationalParityAutomatic(
  parity: Pick<OperationalParityHandling, "handling" | "handlingByDeclarationKind">,
  declarationKind: DeclarationKind,
): boolean {
  return (
    operationalParityHandlingForDeclaration(parity, declarationKind) === "gestito-automaticamente"
  );
}

export function isOperationalParityOfficeReserved(
  parity: Pick<OperationalParityHandling, "handling" | "handlingByDeclarationKind">,
  declarationKind?: DeclarationKind,
): boolean {
  const handling = declarationKind
    ? operationalParityHandlingForDeclaration(parity, declarationKind)
    : parity.handling;
  return handling === "riservato-ufficio";
}
