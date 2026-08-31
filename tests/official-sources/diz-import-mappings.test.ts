import assert from "node:assert/strict";
import { test } from "node:test";
import importMappings from "../../src/domain/official-catalog/diz-import-mappings.json" with { type: "json" };
import { importMappingFor } from "../../src/domain/diz/import-mappings.ts";
import { getCatalogField } from "../../src/domain/official-catalog/catalog.ts";

test("la mappa DIZ di acquisizione copre il catalogo derivabile dal convertitore ufficiale", () => {
  assert.deepEqual(importMappings.counts, {
    catalogFields: 759,
    mappedCatalogFields: 749,
    mappingAliases: 1742,
    catalogOnlyFields: 10,
    converterOnlyAliases: 215,
    ambiguousRecordCodes: 1,
  });
  assert.equal(
    importMappings.source.sha256,
    "e396845477cbc0b7628d75d46782748ec5d1452380e21a59af810ed95709f712",
  );
  for (const mapping of importMappings.mappings) {
    const field = getCatalogField(mapping.catalogFieldId);
    assert.ok(field, mapping.catalogFieldId);
    assert.equal(field.technicalPath, mapping.technicalPath);
    assert.ok(field.sourceIds.includes("SRC-08"));
  }
});

test("ogni alias DIZ identifica un solo campo per la posizione del modulo", () => {
  for (const mapping of importMappings.mappings) {
    if (importMappings.ambiguousRecordCodes.includes(mapping.recordCode)) continue;
    const quadro = mapping.recordCode.startsWith("B") ? "B" : mapping.recordCode.slice(0, 2);
    const locator = {
      quadro,
      module: mapping.moduleVariant === "repeated" ? "00000002" : "00000001",
      field: mapping.recordCode.slice(quadro.length),
    };
    assert.equal(importMappingFor(locator)?.catalogFieldId, mapping.catalogFieldId);
  }
  assert.deepEqual(importMappings.ambiguousRecordCodes, ["EG010E0100000001"]);
  assert.throws(
    () =>
      importMappingFor({
        quadro: "EG",
        module: "00000001",
        field: "010E0100000001",
      }),
    /DIZ_IMPORT_MAPPING_AMBIGUOUS/u,
  );
});
