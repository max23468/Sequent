#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const SUCCESS = "success";

export function evaluatePrGate({
  arm64,
  arm64Result,
  browser,
  browserResult,
  classificationResult,
  compliance,
  complianceResult,
  doctorResult,
  level,
  publicResult,
  rapidResult,
}) {
  const failures = [];
  requireSuccess(failures, "classificazione", classificationResult);
  requireSuccess(failures, "gate rapidi", rapidResult);

  if (level !== "rapid") {
    requireSuccess(failures, "gate pubblici", publicResult);
    requireSuccess(failures, "Svelte Doctor", doctorResult);
  }
  if (browser === "true") requireSuccess(failures, "gate browser", browserResult);
  if (arm64 === "true") requireSuccess(failures, "immagine ARM64", arm64Result);
  if (compliance === "true")
    requireSuccess(failures, "fonti e catalogo ministeriale", complianceResult);

  return { ok: failures.length === 0, failures };
}

function requireSuccess(failures, label, result) {
  if (result !== SUCCESS) failures.push(`${label}: ${result || "mancante"}`);
}

function main() {
  const result = evaluatePrGate({
    arm64: process.env.REQUIRE_ARM64,
    arm64Result: process.env.ARM64_RESULT,
    browser: process.env.REQUIRE_BROWSER,
    browserResult: process.env.BROWSER_RESULT,
    classificationResult: process.env.CLASSIFICATION_RESULT,
    compliance: process.env.REQUIRE_COMPLIANCE,
    complianceResult: process.env.COMPLIANCE_RESULT,
    doctorResult: process.env.DOCTOR_RESULT,
    level: process.env.PUBLICATION_LEVEL,
    publicResult: process.env.PUBLIC_RESULT,
    rapidResult: process.env.RAPID_RESULT,
  });
  if (!result.ok) {
    console.error(`Gate PR incompleto:\n${result.failures.join("\n")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Gate PR ${process.env.PUBLICATION_LEVEL} completo`);
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main();
