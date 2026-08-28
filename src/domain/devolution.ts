export interface DevolutionShare {
  assetId?: string;
  beneficiaryId: string;
  numerator: bigint;
  denominator: bigint;
  rightCode: string;
  valueCents: bigint;
}

export interface DevolutionIssue {
  id: string;
  message: string;
  blocking: true;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function validateDevolutionScenario(
  beneficiaryIds: ReadonlySet<string>,
  shares: DevolutionShare[],
): DevolutionIssue[] {
  const issues: DevolutionIssue[] = [];
  for (const share of shares) {
    if (!beneficiaryIds.has(share.beneficiaryId))
      issues.push({
        id: "DEVOLUTION_BENEFICIARY_MISSING",
        message:
          "Un beneficiario della devoluzione non appartiene ai soggetti condivisi del procedimento.",
        blocking: true,
      });
    if (share.numerator <= 0n || share.denominator <= 0n || share.numerator > share.denominator) {
      issues.push({
        id: "DEVOLUTION_SHARE_INVALID",
        message: "Numeratore e denominatore della quota non sono validi.",
        blocking: true,
      });
      continue;
    }
  }
  const groups = new Map<string, DevolutionShare[]>();
  for (const share of shares) {
    const key = share.assetId ?? "complete-estate";
    const group = groups.get(key) ?? [];
    group.push(share);
    groups.set(key, group);
  }
  if (groups.size === 0)
    issues.push({
      id: "DEVOLUTION_NOT_BALANCED",
      message: "Lo scenario non contiene alcuna quota da controllare.",
      blocking: true,
    });
  for (const [assetId, group] of groups) {
    const validShares = group.filter(
      (share) =>
        share.numerator > 0n && share.denominator > 0n && share.numerator <= share.denominator,
    );
    if (validShares.length !== group.length) continue;
    let commonDenominator = 1n;
    for (const share of validShares)
      commonDenominator =
        (commonDenominator * share.denominator) /
        greatestCommonDivisor(commonDenominator, share.denominator);
    const total = validShares.reduce(
      (sum, share) => sum + share.numerator * (commonDenominator / share.denominator),
      0n,
    );
    if (total !== commonDenominator)
      issues.push({
        id: "DEVOLUTION_NOT_BALANCED",
        message:
          assetId === "complete-estate"
            ? "Le quote dello scenario non sommano all’intero."
            : "Le quote attribuite per uno dei beni non sommano all’intero.",
        blocking: true,
      });
  }
  return issues;
}
