import { listQuadroFields } from "../../domain/official-catalog/catalog.ts";
import type { OperationalParityRow } from "../../domain/operational-parity.ts";
import {
  isSuccessioniOnLineQuadroReadOnlyControl,
  successioniOnLineLayout,
} from "../../domain/successionionline-layout.ts";
import { successioniOnLineDisabledWhen } from "../../domain/successionionline-behavior.ts";
import { successioniOnLineEgBucketForField } from "../../domain/successionionline-eg.ts";

type CatalogField = ReturnType<typeof listQuadroFields>[number];

export function createPracticeFieldView(
  field: CatalogField,
  parity: OperationalParityRow,
  includeSuccessioniOnLineLayout = false,
) {
  const applicationLayout = successioniOnLineLayout(field.canonicalId);
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
    choiceSource: field.choiceSource,
    choiceProvinceFieldId: field.choiceProvinceFieldId,
    appliesToDeclarationKinds: field.appliesToDeclarationKinds,
    options: field.control === "combobox" ? [] : field.options,
    ...(includeSuccessioniOnLineLayout
      ? {
          successioniOnLineOrder: applicationLayout?.order ?? null,
          successioniOnLineSection: applicationLayout?.section ?? null,
          successioniOnLinePage: applicationLayout?.page ?? null,
          successioniOnLineControlTypes: applicationLayout?.uiControls ?? [],
          successioniOnLineQuadroReadOnly: isSuccessioniOnLineQuadroReadOnlyControl(
            applicationLayout?.uiControls ?? [],
          ),
          successioniOnLineRadioGroup: applicationLayout?.radioGroup ?? null,
          successioniOnLineDisabledWhen: successioniOnLineDisabledWhen(field.canonicalId),
          successioniOnLineAttachmentBucket: successioniOnLineEgBucketForField(field.canonicalId),
        }
      : {}),
    successioniOnLineRadioPanel: applicationLayout?.uiControls.includes("RadioPannello") ?? false,
    type: field.type,
    instructions: field.instructions.map(({ id, instruction }) => ({ id, instruction })),
    operationalParity: {
      quadro: parity.quadro,
      candidateContext: parity.candidateContext,
      applicability: {
        xsdPresence: parity.applicability.xsdPresence,
        choiceGroup: parity.applicability.choiceGroup,
      },
      cardinality: { effectiveMin: parity.cardinality.effectiveMin },
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
