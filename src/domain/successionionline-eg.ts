import applicationEvidence from "./official-catalog/successionionline-field-evidence.json" with { type: "json" };
import type { ParsedDiz } from "./diz/index.ts";

export type SuccessioniOnLineEgBucketId =
  (typeof applicationEvidence.attachmentBuckets)[number]["id"];

const bucketByChecklistRuleId: Record<string, SuccessioniOnLineEgBucketId> = {
  "family-status-declaration": "EG1",
  will: "EG2",
  inventory: "EG3",
  "foreign-tax": "EG4",
  "liability-proof": "EG5",
  "family-tree": "EG6",
  "identity-substitute-signers": "EG7",
  "trust-instrument": "EG8",
  "disabled-trust-declaration": "EG8",
  "company-balance-sheet": "EG8",
  "foreign-asset-certificates": "EG8",
  "foreign-document-translation": "EG8",
  "first-home-declaration": "EG9",
  "first-home-natural-event": "EG9",
  "ipocatastal-relief-proof": "EG10",
  "succession-reduction-proof": "EG11",
  "business-continuation": "EG11",
};

export function successioniOnLineEgBucketForChecklistItem(
  checklistItemId: string,
): SuccessioniOnLineEgBucketId | null {
  const ruleId = checklistItemId.slice(checklistItemId.lastIndexOf(":") + 1);
  return bucketByChecklistRuleId[ruleId] ?? null;
}

export const SUCCESSIONIONLINE_EG_BUCKETS = applicationEvidence.attachmentBuckets.map((bucket) => ({
  ...bucket,
}));

export function qualifiedOfficialEgDizEvidence(parsed: ParsedDiz): {
  attachments: number;
  qualifiedBucketLinks: number;
  countsMatch: true;
} {
  const counts = new Map<string, number>();
  for (const attachment of parsed.attachments) {
    if (
      !attachment.recordCode ||
      !SUCCESSIONIONLINE_EG_BUCKETS.some((bucket) => bucket.recordCode === attachment.recordCode)
    )
      throw new Error("DIZ_EG_ATTACHMENTS_NOT_QUALIFIED");
    counts.set(attachment.recordCode, (counts.get(attachment.recordCode) ?? 0) + 1);
  }
  for (const bucket of SUCCESSIONIONLINE_EG_BUCKETS) {
    const expected = counts.get(bucket.recordCode) ?? 0;
    const countFields = parsed.fields.filter(
      (field) => `${field.quadro}${field.field}` === bucket.recordCode,
    );
    if (countFields.length === 0 && expected === 0) continue;
    if (
      countFields.length !== 1 ||
      !/^\d+$/u.test(countFields[0]!.value) ||
      Number(countFields[0]!.value) !== expected
    )
      throw new Error("DIZ_EG_ATTACHMENTS_NOT_QUALIFIED");
  }
  return {
    attachments: parsed.attachments.length,
    qualifiedBucketLinks: parsed.attachments.length,
    countsMatch: true,
  };
}

export function successioniOnLineEgBucketForField(fieldId: string) {
  return SUCCESSIONIONLINE_EG_BUCKETS.find((bucket) => bucket.fieldId === fieldId) ?? null;
}
