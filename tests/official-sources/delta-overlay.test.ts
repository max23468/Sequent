import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const technical = JSON.parse(
  readFileSync("src/domain/official-catalog/technical-schema.json", "utf8"),
);
const overlays = JSON.parse(
  readFileSync("src/domain/official-catalog/delta-overlays.json", "utf8"),
);
const manifest = JSON.parse(
  readFileSync("src/domain/official-catalog/source-manifest.json", "utf8"),
);
const officialCatalog = JSON.parse(
  readFileSync("src/domain/official-catalog/official-catalog.json", "utf8"),
);

const normalized = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const documentationFor = (name: string) =>
  normalized(
    technical.elements
      .filter((element: { name: string }) => element.name === name)
      .flatMap((element: { documentation?: string[] }) => element.documentation ?? [])
      .join(" "),
  );

test("le correzioni SRC-09 sono presenti nello schema corrente", () => {
  const expected = [
    ["Agevolazioni", "agevolazione n non puo essere richiesta"],
    ["Agevolazioni", "devoluzione a soggetti di tipo 5 (trust)"],
    ["Riduzioni", "stesso valore in tutti i righi della devoluzione"],
    ["ImpostaBollo_CopiaConforme", "codice carica 9"],
    ["ImpostaNonDovuta", "campo obbligatorio se il presentatore ha codice carica 9"],
    ["ImpostaCalcolata", "non puo essere presente se il presentatore ha codice carica 9"],
    ["ImpostaDaVersare", "minore o uguale a 10 euro"],
    ["TempisticaPagamento", "imposta da versare e uguale a zero"],
    ["ValorePrecSucc", "obbligatorio in presenza di riduzioni art. 25"],
    ["CodiceFiscale", "soggetto diverso da persona fisica"],
    ["TipoSoggetto", "beneficiario presente su piu righi"],
    ["GradoParentela", "valore '35' (estraneo/a)"],
    ["GradoParentela", "se compilato il campo 'denominazione'"],
    ["PortatoreHandicap", "persona con disabilita deve coincidere"],
  ] as const;
  for (const [name, snippet] of expected) {
    assert.match(
      documentationFor(name),
      new RegExp(normalized(snippet).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }

  const disability = documentationFor("PortatoreHandicap");
  assert.doesNotMatch(disability, /deve essere uguale a 1 se esiste almeno un altro rigo/);
});

test("le nuove fonti restano catalogate e bloccanti finché non sono riconciliate", () => {
  assert.equal(manifest.sources.length, 40);
  assert.equal(officialCatalog.coverage.sourceArtifacts, manifest.sources.length);
  assert.equal(overlays.status, "incomplete");

  const coveredByUpdate = new Set(
    overlays.sourceUpdates.flatMap((entry: { sourceIds: string[] }) => entry.sourceIds),
  );
  const coveredByLineage = new Set(
    overlays.lineage.map((entry: { sourceId: string }) => entry.sourceId),
  );
  for (let number = 11; number <= 40; number += 1) {
    const sourceId = `SRC-${String(number).padStart(2, "0")}`;
    assert.ok(manifest.sources.some((entry: { id: string }) => entry.id === sourceId));
    assert.ok(coveredByUpdate.has(sourceId) || coveredByLineage.has(sourceId));
  }

  const annualSources = manifest.sources.filter(
    (entry: { category?: string }) => entry.category === "valore-annuale",
  );
  assert.equal(annualSources.length, 4);
  assert.ok(annualSources.every((entry: { effectiveFrom?: string }) => entry.effectiveFrom));
  assert.ok(annualSources.every((entry: { effectiveTo?: string }) => entry.effectiveTo));

  const softwareSources = manifest.sources.filter((entry: { id: string }) => {
    const number = Number(entry.id.slice(4));
    return number >= 32 && number <= 40;
  });
  assert.equal(softwareSources.length, 9);
  assert.ok(
    softwareSources.every((entry: { alias: string }) => entry.alias.startsWith("software/")),
  );
  for (const sourceId of ["SRC-33", "SRC-34"]) {
    const source = manifest.sources.find((entry: { id: string }) => entry.id === sourceId);
    assert.equal(source.officialSha256, source.sha256);
  }

  assert.ok(
    officialCatalog.blockers.some((blocker: string) =>
      blocker.includes("linea temporale articolo per articolo"),
    ),
  );
});

test("tipo Provincia e successione delle fonti restano espliciti", () => {
  const provinceOverlay = overlays.overlays.find((entry: { items: string[] }) =>
    entry.items.includes("q"),
  );
  assert.equal(provinceOverlay.state, "applied-and-tested");
  assert.ok(provinceOverlay.targets.length > 0);
  for (const path of provinceOverlay.targets) {
    const field = technical.elements.find((element: { path: string }) => element.path === path);
    assert.equal(field?.sourceId, "SRC-08");
    assert.ok(field?.type);
  }

  const emptyItem = overlays.overlays.find((entry: { items: string[] }) =>
    entry.items.includes("n"),
  );
  assert.equal(emptyItem.state, "not-applicable");
  assert.deepEqual(emptyItem.targets, []);

  for (const sourceId of ["SRC-02", "SRC-06"]) {
    const source = manifest.sources.find((entry: { id: string }) => entry.id === sourceId);
    const lineage = overlays.lineage.find(
      (entry: { sourceId: string }) => entry.sourceId === sourceId,
    );
    assert.ok(source);
    assert.equal(lineage?.state, "superseded-by-later-source");
    assert.deepEqual(lineage?.authoritativeSuccessors, ["SRC-07", "SRC-08", "SRC-09"]);
  }
});
