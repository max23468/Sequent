import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePrGate } from "./pr-gate.mjs";

const base = {
  arm64: "false",
  arm64Result: "skipped",
  browser: "false",
  browserResult: "skipped",
  classificationResult: "success",
  doctorResult: "skipped",
  level: "rapid",
  publicResult: "skipped",
  rapidResult: "success",
};

test("una PR rapida non richiede suite non pertinenti", () => {
  assert.deepEqual(evaluatePrGate(base), { ok: true, failures: [] });
});

test("una PR ordinaria richiede gate pubblici e Doctor", () => {
  const ordinary = { ...base, level: "ordinary", publicResult: "success", doctorResult: "success" };
  assert.equal(evaluatePrGate(ordinary).ok, true);
  const failed = evaluatePrGate({ ...ordinary, doctorResult: "failure" });
  assert.equal(failed.ok, false);
  assert.match(failed.failures[0], /Svelte Doctor/);
});

test("i gate browser e ARM64 sono obbligatori quando classificati", () => {
  const sensitive = {
    ...base,
    level: "sensitive",
    publicResult: "success",
    doctorResult: "success",
    browser: "true",
    browserResult: "success",
    arm64: "true",
    arm64Result: "success",
  };
  assert.equal(evaluatePrGate(sensitive).ok, true);
  assert.equal(evaluatePrGate({ ...sensitive, arm64Result: "skipped" }).ok, false);
});

test("un risultato cancellato o mancante non viene scambiato per successo", () => {
  assert.equal(evaluatePrGate({ ...base, rapidResult: "cancelled" }).ok, false);
  assert.equal(evaluatePrGate({ ...base, classificationResult: "" }).ok, false);
});
