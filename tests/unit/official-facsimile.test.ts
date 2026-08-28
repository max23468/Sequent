import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import facsimileLayout from "../../src/domain/official-catalog/facsimile-layout.json" with { type: "json" };
import { listQuadroFields, type QuadroId } from "../../src/domain/official-catalog/catalog.ts";
import {
  createEmptyDeclaration,
  setCanonicalField,
  type DeclarationSnapshot,
} from "../../src/domain/declaration.ts";
import { createOfficialFacsimilePdf } from "../../src/lib/server/official-facsimile.ts";

function applied(
  declaration: DeclarationSnapshot,
  fieldId: string,
  value: string,
  entityId: string | null = null,
): DeclarationSnapshot {
  return setCanonicalField(
    declaration,
    fieldId,
    value,
    "manually_corrected",
    ["fixture"],
    entityId,
  );
}

function input(declaration: DeclarationSnapshot) {
  return {
    declaration,
    revision: 7,
    ready: false,
    generatedAt: "2026-08-28T12:00:00.000Z",
    digest: "f".repeat(64),
    subjects: [{ id: "subject-1", sequence: 1 }],
    assets: [{ id: "asset-1", quadro: "EB" as const }],
  };
}

describe("fac-simile del modello ufficiale", () => {
  it("usa soltanto le pagine pertinenti e conserva il modello come sfondo", async () => {
    const ebProvince = listQuadroFields("EB").find((field) => field.visibleNumber === "1");
    expect(ebProvince).toBeDefined();
    let declaration = createEmptyDeclaration();
    declaration = applied(
      declaration,
      "frontespizio.defunto.codice-fiscale",
      "RSSMRA80A01H501U",
      "decedent-1",
    );
    declaration = applied(
      declaration,
      "quadro-ea.soggetto.codice-fiscale",
      "RSSNNA80A41H501A",
      "subject-1",
    );
    declaration = applied(declaration, "quadro-ea.soggetto.tipo", "1", "subject-1");
    declaration = applied(declaration, ebProvince!.canonicalId, "RM", "asset-1");

    const bytes = await createOfficialFacsimilePdf(input(declaration));
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toContain("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getTitle()).toBe("Fac-simile dichiarazione - revisione 7");
    expect(pdf.getKeywords()).toContain("non trasmettibile");
  });

  it("non stampa una proposta non ancora applicata", async () => {
    const declaration = setCanonicalField(
      createEmptyDeclaration(),
      "xsd:/Fornitura/Dichiarazione/Frontespizio/Versamento/IBAN",
      "IT00X0000000000000000000000",
      "to_review",
      ["fixture"],
    );
    const bytes = await createOfficialFacsimilePdf({
      ...input(declaration),
      subjects: [],
      assets: [],
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it("blocca un valore applicato privo di posizione qualificata", async () => {
    const declaration = applied(
      createEmptyDeclaration(),
      "xsd:/Fornitura/Dichiarazione/Frontespizio/Versamento/IBAN",
      "IT00X0000000000000000000000",
    );
    await expect(
      createOfficialFacsimilePdf({ ...input(declaration), subjects: [], assets: [] }),
    ).rejects.toMatchObject({
      code: "FIELD_UNMAPPED",
      fieldId: "xsd:/Fornitura/Dichiarazione/Frontespizio/Versamento/IBAN",
    });
  });

  it("blocca un valore che richiederebbe un troncamento", async () => {
    const declaration = applied(
      createEmptyDeclaration(),
      "frontespizio.defunto.stato-civile",
      "VALORE CHE NON PUÒ ENTRARE NEL CAMPO",
      "decedent-1",
    );
    await expect(
      createOfficialFacsimilePdf({ ...input(declaration), subjects: [], assets: [] }),
    ).rejects.toMatchObject({
      code: "VALUE_OVERFLOW",
      fieldId: "frontespizio.defunto.stato-civile",
    });
  });

  it("genera tutte le pagine pertinenti dei quadri supportati", async () => {
    const quadri: QuadroId[] = [
      "EA",
      "EB",
      "EC",
      "ER",
      "ED",
      "EE",
      "EF",
      "EG",
      "EH",
      "EI",
      "EL",
      "EM",
      "EN",
      "EO",
      "EP",
      "EQ",
    ];
    const entityQuadri = new Set<QuadroId>([
      "EA",
      "EB",
      "EC",
      "ER",
      "ED",
      "EL",
      "EM",
      "EN",
      "EO",
      "EP",
      "EQ",
    ]);
    let declaration = createEmptyDeclaration();
    const assets: Array<{ id: string; quadro: QuadroId }> = [];
    for (const quadro of quadri) {
      const anchorNumbers = new Set(
        facsimileLayout.quadri[quadro as keyof typeof facsimileLayout.quadri].anchors.map(
          (anchor) => anchor.number,
        ),
      );
      const field = listQuadroFields(quadro).find(
        (candidate) =>
          candidate.visibleFieldId !== null &&
          candidate.visibleNumber !== null &&
          ((["EE", "EF", "EG"] as QuadroId[]).includes(quadro) ||
            anchorNumbers.has(candidate.visibleNumber)),
      );
      expect(field, `campo visuale ${quadro}`).toBeDefined();
      const entityId =
        quadro === "EA" ? "subject-all" : entityQuadri.has(quadro) ? `asset-${quadro}` : null;
      const occurrenceId = field!.entityScope === "occurrence" ? `occurrence-${quadro}` : null;
      declaration = setCanonicalField(
        declaration,
        field!.canonicalId,
        "1",
        "manually_corrected",
        ["fixture"],
        entityId,
        occurrenceId,
      );
      if (quadro !== "EA" && entityQuadri.has(quadro)) assets.push({ id: entityId!, quadro });
    }
    const bytes = await createOfficialFacsimilePdf({
      ...input(declaration),
      subjects: [{ id: "subject-all", sequence: 1 }],
      assets,
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(17);
  });
});
