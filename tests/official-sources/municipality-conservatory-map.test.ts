import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildMunicipalityConservatoryCatalog } from "../../scripts/official-sources/generate-municipality-conservatory-map.ts";

test("la mappa Comune-conservatoria è riproducibile dalla fonte ufficiale SRC-39", async () => {
  const generated = await buildMunicipalityConservatoryCatalog();
  const committed = JSON.parse(
    await readFile("src/domain/official-catalog/municipality-conservatory-map.json", "utf8"),
  );
  assert.deepEqual(committed, generated);
  assert.equal(generated.counts.municipalities, 7_999);
  assert.equal(generated.counts.conservatories, 139);
  assert.equal(generated.counts.tavolareMunicipalities, 345);
  assert.equal(generated.source.sourceId, "SRC-39");
  assert.ok(generated.source.resourceChecksum.length > 0);
});

test("la mappa comprende fusioni correnti e codici nazionali speciali", async () => {
  const generated = await buildMunicipalityConservatoryCatalog();
  assert.equal(generated.conservatoryByMunicipalityCode[["M", "439"].join("")], "VI00");
  assert.equal(generated.conservatoryByMunicipalityCode.G831A, null);
  assert.equal(generated.conservatoryByMunicipalityCode.G831B, null);
});
