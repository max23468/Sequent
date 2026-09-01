import applicationEvidence from "./official-catalog/successionionline-field-evidence.json" with { type: "json" };

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

export function successioniOnLineEgBucketForField(fieldId: string) {
  return SUCCESSIONIONLINE_EG_BUCKETS.find((bucket) => bucket.fieldId === fieldId) ?? null;
}
