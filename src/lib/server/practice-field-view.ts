import { listQuadroFields } from "../../domain/official-catalog/catalog.ts";
import type { OperationalParityRow } from "../../domain/operational-parity.ts";

type CatalogField = ReturnType<typeof listQuadroFields>[number];

export function createPracticeFieldView(field: CatalogField, parity: OperationalParityRow) {
  return {
    canonicalId: field.canonicalId,
    label: field.label,
    visibleNumber: field.visibleNumber,
    section: field.section,
    saveGroup: field.saveGroup,
    entityScope: field.entityScope,
    occurrenceGroup: field.occurrenceGroup,
    entryMode: field.entryMode,
    derivedFrom: field.derivedFrom,
    control: field.control,
    appliesToDeclarationKinds: field.appliesToDeclarationKinds,
    options: field.options,
    type: field.type,
    instructions: field.instructions.map(({ id, instruction }) => ({ id, instruction })),
    operationalParity: {
      quadro: parity.quadro,
      candidateContext: parity.candidateContext,
      handling: parity.handling,
      handlingByDeclarationKind: parity.handlingByDeclarationKind,
      semanticReview: {
        status: parity.semanticReview.status,
        reason: parity.semanticReview.reason,
        blocker: parity.semanticReview.blocker,
      },
    },
  };
}
