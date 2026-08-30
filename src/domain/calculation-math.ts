export function nonNegative(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

export function divideRoundedHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n;
  return (numerator + denominator / 2n) / denominator;
}

export function divideTruncated(numerator: bigint, denominator: bigint): bigint {
  return denominator <= 0n ? 0n : numerator / denominator;
}

export function roundToWholeEuro(valueCents: bigint): bigint {
  if (valueCents <= 0n) return 0n;
  return ((valueCents + 50n) / 100n) * 100n;
}

export function positiveDifference(...values: bigint[]): bigint {
  return nonNegative(
    values.reduce((result, value, index) => (index === 0 ? value : result - value), 0n),
  );
}
