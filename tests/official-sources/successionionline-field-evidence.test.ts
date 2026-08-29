import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QUADRI, listQuadroFields } from "../../src/domain/official-catalog/catalog.ts";
import {
  buildOperationalParityMap,
  requiresOfficialApplicationEvidence,
} from "../../src/domain/operational-parity.ts";

interface ApplicationEvidence {
  schemaVersion: number;
  application: {
    name: string;
    model: string;
    sources: Array<{ file: string; sha256: string }>;
  };
  counts: {
    reviewedFields: number;
    professionista: number;
    automatico: number;
    "riservato-ufficio": number;
  };
  fields: Array<{
    fieldId: string;
    recordCode: string;
    uiControls: string[];
    reviewedProducer: "professionista" | "automatico" | "riservato-ufficio";
    producerBasis: string;
  }>;
}

async function readEvidence(): Promise<ApplicationEvidence> {
  return JSON.parse(
    await readFile("src/domain/official-catalog/successionionline-field-evidence.json", "utf8"),
  ) as ApplicationEvidence;
}

test("l’evidenza SuccessioniOnLine registra 257 campi e copre tutti i residui correnti", async () => {
  const evidence = await readEvidence();
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.application.name, "SuccessioniOnLine");
  assert.equal(evidence.application.model, "SUC13");
  assert.deepEqual(evidence.counts, {
    reviewedFields: 257,
    professionista: 230,
    automatico: 19,
    "riservato-ufficio": 8,
  });
  assert.equal(evidence.fields.length, evidence.counts.reviewedFields);
  assert.equal(new Set(evidence.fields.map(({ fieldId }) => fieldId)).size, evidence.fields.length);
  assert.ok(evidence.application.sources.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256)));
  const expectedFieldIds = QUADRI.flatMap((quadro) =>
    listQuadroFields(quadro)
      .filter((field) => field.visibleFieldId !== null)
      .filter((field) => requiresOfficialApplicationEvidence(quadro, field))
      .map((field) => field.canonicalId),
  ).sort();
  const evidenceFieldIds = evidence.fields.map(({ fieldId }) => fieldId).sort();
  assert.ok(expectedFieldIds.every((fieldId) => evidenceFieldIds.includes(fieldId)));
  const sourceQualifiedOverrides = evidence.fields.filter(
    ({ fieldId }) => !expectedFieldIds.includes(fieldId),
  );
  assert.equal(sourceQualifiedOverrides.length, 2);
  const rowsByFieldId = new Map(buildOperationalParityMap().map((row) => [row.fieldId, row]));
  assert.ok(
    sourceQualifiedOverrides.every(
      ({ fieldId }) => rowsByFieldId.get(fieldId)?.handlingBasis === "explicit-professional-input",
    ),
  );
});

test("ogni evidenza applicativa alimenta la matrice senza promozioni per analogia", async () => {
  const evidence = await readEvidence();
  const rowsByFieldId = new Map(buildOperationalParityMap().map((row) => [row.fieldId, row]));
  for (const field of evidence.fields) {
    const row = rowsByFieldId.get(field.fieldId);
    assert.ok(row, field.fieldId);
    assert.equal(row.semanticReview.status, "qualificata", field.fieldId);
    assert.ok(
      row.handlingBasis === "official-application-behavior" ||
        row.handlingBasis === "explicit-professional-input",
      field.fieldId,
    );
    if (row.handlingBasis === "explicit-professional-input")
      assert.equal(field.reviewedProducer, "professionista", field.fieldId);
    assert.ok(
      row.semanticReview.provenance.includes(
        `src/domain/official-catalog/successionionline-field-evidence.json#${field.recordCode}`,
      ),
      field.fieldId,
    );
    assert.equal(
      row.handling,
      field.reviewedProducer === "professionista"
        ? "inserito"
        : field.reviewedProducer === "automatico"
          ? "gestito-automaticamente"
          : "riservato-ufficio",
      field.fieldId,
    );
    if (field.producerBasis === "controllo-input-diretto")
      assert.ok(field.uiControls.length > 0, field.fieldId);
  }
});
