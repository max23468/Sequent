import applicationEvidence from "./official-catalog/successionionline-field-evidence.json" with { type: "json" };

function fieldVariant(fieldId: string): "first" | "repeated" | "shared" {
  if (fieldId.includes("/PrimoModulo/")) return "first";
  if (fieldId.includes("/Modulo/")) return "repeated";
  return "shared";
}

const layoutByFieldId = new Map(
  applicationEvidence.layout.map((item) => [item.fieldId, item] as const),
);

const fieldsByRecordCode = new Map<string, string[]>();
for (const item of applicationEvidence.layout) {
  const fields = fieldsByRecordCode.get(item.recordCode) ?? [];
  fields.push(item.fieldId);
  fieldsByRecordCode.set(item.recordCode, fields);
}

function triggerFieldId(targetFieldId: string, triggerRecordCode: string): string | null {
  const candidates = fieldsByRecordCode.get(triggerRecordCode) ?? [];
  if (candidates.length === 1) return candidates[0]!;
  const variant = fieldVariant(targetFieldId);
  return candidates.find((candidate) => fieldVariant(candidate) === variant) ?? null;
}

export interface SuccessioniOnLineDisabledWhen {
  fieldId: string;
  value: "1";
  sourcePointer: string;
}

export function successioniOnLineDisabledWhen(fieldId: string): SuccessioniOnLineDisabledWhen[] {
  const recordCode = layoutByFieldId.get(fieldId)?.recordCode;
  if (!recordCode) return [];
  return applicationEvidence.conditionalRules.flatMap((rule) => {
    if (!rule.targetRecordCodes.includes(recordCode)) return [];
    const trigger = triggerFieldId(fieldId, rule.triggerRecordCode);
    return trigger
      ? [{ fieldId: trigger, value: "1" as const, sourcePointer: rule.sourcePointer }]
      : [];
  });
}

export function isSuccessioniOnLineFieldDisabled(
  fieldId: string,
  valueForField: (relatedFieldId: string) => string,
): boolean {
  return successioniOnLineDisabledWhen(fieldId).some(
    (condition) => valueForField(condition.fieldId) === condition.value,
  );
}
