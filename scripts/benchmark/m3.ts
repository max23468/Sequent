import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateM3Benchmark } from "../../src/lib/benchmark/m3.ts";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const datasetPath = argument("--dataset");
const outputPath = argument("--output");
if (!datasetPath) throw new Error("Usa --dataset <percorso-json>.");

const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
const report = {
  format: "sequent-m3-benchmark",
  version: 1,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? process.env.SEQUENT_COMMIT ?? "working-tree",
  model: process.env.SEQUENT_CODEX_MODEL ?? "gpt-5.6-terra",
  effort: "high",
  promptVersion: "m3-practice-analysis-v3",
  ocrVersion: process.env.SEQUENT_OCR_VERSION ?? "runtime",
  rulesVersion: "m3-source-hierarchy-v1",
  ...evaluateM3Benchmark(dataset),
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) await writeFile(resolve(outputPath), serialized, { mode: 0o600 });
else process.stdout.write(serialized);
if (!report.passedM3Safety) process.exitCode = 1;
