import { writeFileSync } from "node:fs";
import { createEmptyDeclaration, setCanonicalField } from "../../src/domain/declaration.ts";
import facsimileLayout from "../../src/domain/official-catalog/facsimile-layout.json" with { type: "json" };
import { listQuadroFields, type QuadroId } from "../../src/domain/official-catalog/catalog.ts";
import { createOfficialFacsimilePdf } from "../../src/lib/server/official-facsimile.ts";

let declaration = createEmptyDeclaration();
const set = (
  fieldId: string,
  value: string,
  entityId: string | null = null,
  occurrenceId: string | null = null,
) => {
  declaration = setCanonicalField(
    declaration,
    fieldId,
    value,
    "manually_corrected",
    ["fixture-sintetica"],
    entityId,
    occurrenceId,
  );
};

set("frontespizio.defunto.codice-fiscale", "RSSMRA45A01H501U", "decedent-1");
set("frontespizio.dichiarazione-precedente.anno", "2025");
set("frontespizio.devoluzione.per-legge", "1");
set("frontespizio.beneficiari.beneficio-inventario", "1");
set("frontespizio.defunto.cognome", "ROSSI", "decedent-1");
set("frontespizio.defunto.nome", "MARIO", "decedent-1");
set("frontespizio.defunto.sesso", "M", "decedent-1");
set("frontespizio.defunto.data-nascita", "01011945", "decedent-1");
set("frontespizio.defunto.comune-nascita", "ROMA", "decedent-1");
set("frontespizio.defunto.provincia-nascita", "RM", "decedent-1");
set("frontespizio.defunto.data-decesso", "15082025", "decedent-1");
set("quadro-ea.soggetto.codice-fiscale", "RSSNNA70A41H501Y", "subject-1");
set("quadro-ea.soggetto.tipo", "1", "subject-1");
set("quadro-ea.soggetto.grado-parentela", "1", "subject-1");
set("quadro-ea.soggetto.dati-anagrafici.cognome", "ROSSI", "subject-1");
set("quadro-ea.soggetto.nome", "ANNA", "subject-1");
set("quadro-ea.soggetto.sesso", "F", "subject-1");
set("quadro-ea.soggetto.data-nascita", "01011970", "subject-1");
set("quadro-ea.soggetto.comune-nascita", "ROMA", "subject-1");
set("quadro-ea.soggetto.provincia-nascita", "RM", "subject-1");
for (const [number, value] of [
  ["1", "RM"],
  ["2", "ROMA"],
  ["3", "H501"],
  ["4", "VIA ROMA 1"],
  ["5", "123"],
  ["6", "456"],
  ["23", "250000"],
] as const) {
  const field = listQuadroFields("EB").find((candidate) => candidate.visibleNumber === number);
  if (field) set(field.canonicalId, value, "asset-1");
}
for (const [quadro, indexes, value] of [
  ["EE", [0, 5, 7], "250000"],
  ["EF", [0, 1, 39], "1000"],
  ["EG", [0, 6], "1"],
] as const)
  for (const index of indexes) {
    const field = listQuadroFields(quadro)[index];
    if (field?.visibleFieldId) set(field.canonicalId, value);
  }

const assets: Array<{ id: string; quadro: QuadroId }> = [{ id: "asset-1", quadro: "EB" }];
for (const quadro of [
  "EC",
  "ER",
  "ED",
  "EH",
  "EI",
  "EL",
  "EM",
  "EN",
  "EO",
  "EP",
  "EQ",
] as QuadroId[]) {
  const anchorNumbers = new Set(
    facsimileLayout.quadri[quadro as keyof typeof facsimileLayout.quadri].anchors.map(
      (anchor) => anchor.number,
    ),
  );
  const field = listQuadroFields(quadro).find(
    (candidate) =>
      candidate.visibleFieldId !== null &&
      candidate.visibleNumber !== null &&
      anchorNumbers.has(candidate.visibleNumber),
  );
  if (!field) continue;
  const entityId = ["EH", "EI"].includes(quadro) ? null : `asset-${quadro}`;
  const occurrenceId = field.entityScope === "occurrence" ? `occurrence-${quadro}` : null;
  set(field.canonicalId, "1", entityId, occurrenceId);
  if (entityId) assets.push({ id: entityId, quadro });
}

const bytes = await createOfficialFacsimilePdf({
  declaration,
  revision: 12,
  ready: false,
  generatedAt: "2026-08-28T18:00:00.000Z",
  digest: "a".repeat(64),
  subjects: [{ id: "subject-1", sequence: 1 }],
  assets,
});
writeFileSync(process.argv[2] ?? "tmp/pdfs/facsimile-sintetico.pdf", bytes);
