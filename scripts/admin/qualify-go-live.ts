import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluateGoLiveQualification } from "../../src/lib/benchmark/go-live-qualification.ts";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function assertPrivateInput(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("GO_LIVE_INPUT_FILE_INVALID");
  if ((metadata.mode & 0o077) !== 0) throw new Error("GO_LIVE_INPUT_PERMISSIONS_TOO_OPEN");
}

async function writePrivateReport(path: string, report: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

const inputPath = argument("--input");
const outputPath = argument("--output");
if (!inputPath) throw new Error("GO_LIVE_INPUT_REQUIRED");
if (!outputPath) throw new Error("GO_LIVE_OUTPUT_REQUIRED");

const resolvedInput = resolve(inputPath);
const resolvedOutput = resolve(outputPath);
if (resolvedInput === resolvedOutput) throw new Error("GO_LIVE_INPUT_OUTPUT_COLLISION");
await assertPrivateInput(resolvedInput);

const inputBytes = await readFile(resolvedInput);
const input = JSON.parse(inputBytes.toString("utf8"));
const releaseCommit = process.env.SEQUENT_COMMIT_SHA;
if (!releaseCommit || !/^[a-f0-9]{40}$/.test(releaseCommit))
  throw new Error("GO_LIVE_RELEASE_REQUIRED");
if (input?.candidate?.commit !== releaseCommit) throw new Error("GO_LIVE_RELEASE_MISMATCH");

const report = evaluateGoLiveQualification(input, {
  privateInputSha256: createHash("sha256").update(inputBytes).digest("hex"),
});
await writePrivateReport(resolvedOutput, report);
process.stdout.write(
  `Qualifica go-live: ${report.passed ? "SUPERATA" : "BLOCCATA"}; blocker: ${report.blockers.length}.\n`,
);
if (!report.passed) process.exitCode = 1;
