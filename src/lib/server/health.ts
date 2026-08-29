export const MIN_HEALTHY_FREE_BYTES = 5n * 1024n * 1024n * 1024n;
export const MAX_HEALTHY_DISK_USED_PERCENT = 90n;

export function isStorageHealthy(
  stats: Readonly<{
    bavail: bigint | number;
    blocks: bigint | number;
    bsize: bigint | number;
  }>,
): boolean {
  const blockSize = BigInt(stats.bsize);
  const availableBytes = BigInt(stats.bavail) * blockSize;
  const totalBytes = BigInt(stats.blocks) * blockSize;
  if (totalBytes <= 0n) return false;

  const usedBytes = totalBytes - availableBytes;
  return (
    availableBytes >= MIN_HEALTHY_FREE_BYTES &&
    usedBytes * 100n < totalBytes * MAX_HEALTHY_DISK_USED_PERCENT
  );
}
