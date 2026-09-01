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
  assert.equal(generated.counts.places, 11_718);
  assert.equal(generated.counts.foreignStates, 272);
  assert.equal(generated.counts.registrationOffices, 1_265);
  assert.equal(generated.counts.transcriptionOffices, 138);
  assert.equal(generated.counts.cadastralCategories, 52);
  assert.equal(generated.counts.tavolarePlaces, 876);
  assert.equal(generated.source.sourceId, "SRC-39");
  assert.ok(
    Object.values(generated.source.resources).every(
      (resource) => resource.checksum.length > 0 && resource.sha256.length === 64,
    ),
  );
});

test("la mappa comprende fusioni correnti e codici nazionali speciali", async () => {
  const generated = await buildMunicipalityConservatoryCatalog();
  assert.equal(generated.conservatoryByMunicipalityCode[["M", "439"].join("")], "VI00");
  assert.equal(generated.conservatoryByMunicipalityCode.G831A, null);
  assert.equal(generated.conservatoryByMunicipalityCode.G831B, null);
  assert.ok(
    generated.places.some(
      (place) =>
        place.value === "MILANO" &&
        place.municipalityCode === "F205" &&
        place.provinceCode === "MI",
    ),
  );
  assert.deepEqual(
    generated.tavolareMunicipalities.find((option) => option.value === "001"),
    { value: "001", label: "AGRONE" },
  );
  assert.deepEqual(
    generated.tavolarePlaces.find((place) => place.municipalityCode === "A266"),
    {
      value: "CORTINA D'AMPEZZO",
      label: "CORTINA D'AMPEZZO",
      provinceCode: "BL",
      municipalityCode: "A266",
      validFrom: "1900-01-01",
      validTo: "2099-12-31",
    },
  );
});
