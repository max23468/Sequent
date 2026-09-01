import applicationEvidence from "./official-catalog/successionionline-field-evidence.json" with { type: "json" };

interface CanonicalField {
  canonicalId: string;
}

const layoutByFieldId = new Map(
  applicationEvidence.layout.map((item) => [item.fieldId, item] as const),
);

export function sortForSuccessioniOnLine<T extends CanonicalField>(fields: readonly T[]): T[] {
  return fields
    .map((field, catalogOrder) => ({ field, catalogOrder }))
    .sort((left, right) => {
      const leftOrder = layoutByFieldId.get(left.field.canonicalId)?.order;
      const rightOrder = layoutByFieldId.get(right.field.canonicalId)?.order;
      if (leftOrder === undefined && rightOrder === undefined)
        return left.catalogOrder - right.catalogOrder;
      if (leftOrder === undefined) return 1;
      if (rightOrder === undefined) return -1;
      return leftOrder - rightOrder || left.catalogOrder - right.catalogOrder;
    })
    .map(({ field }) => field);
}

export function successioniOnLineLayout(fieldId: string): {
  order: number;
  section: string;
  page: number;
  uiControls: string[];
  radioGroup: string | null;
} | null {
  const item = layoutByFieldId.get(fieldId);
  return item
    ? {
        order: item.order,
        section: item.section,
        page: item.page,
        uiControls: item.uiControls,
        radioGroup: item.radioGroup,
      }
    : null;
}
