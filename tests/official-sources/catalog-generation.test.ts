import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("deriva percorsi, cardinalità, choice e vincoli dal solo XSD", () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), "sequent-technical-catalog-"));
  const fixtureRoot = resolve("tests/fixtures/official/catalog");
  const outputPath = join(outputDirectory, "technical-schema.json");
  try {
    execFileSync(
      "python3",
      [
        "scripts/official-sources/generate-technical-catalog.py",
        "--source-dir",
        join(fixtureRoot, "xsd"),
        "--main-schema",
        "main.xsd",
        "--manifest",
        join(fixtureRoot, "source-manifest.json"),
        "--output",
        outputPath,
      ],
      { stdio: "pipe" },
    );
    const catalog = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(catalog.bundleId, "SYNTHETIC-OFFICIAL-CATALOG");
    assert.equal(catalog.status, "structurally-qualified");
    assert.equal(catalog.coverage.schemaFiles, 2);
    assert.equal(catalog.coverage.unresolvedReferences, 0);

    const code = catalog.elements.find(
      (element: { path: string }) => element.path === "/Fornitura/Dichiarazione/Codice",
    );
    assert.deepEqual(code.constraints.facets, {
      minLength: ["3"],
      maxLength: ["16"],
      pattern: ["[A-Z0-9]+"],
    });
    assert.deepEqual(code.documentation, ["Codice sintetico"]);

    const alternatives = catalog.elements.filter((element: { choiceGroup: string | null }) =>
      Boolean(element.choiceGroup),
    );
    assert.equal(alternatives.length, 2);
    assert.equal(alternatives[0].choiceGroup, alternatives[1].choiceGroup);

    const repeatedValue = catalog.elements.find(
      (element: { path: string }) => element.path === "/Fornitura/Dichiarazione/Modulo/Valore",
    );
    assert.equal(repeatedValue.effectiveMinOccurs, 0);
    assert.equal(repeatedValue.effectiveMaxOccurs, "unbounded");
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});
