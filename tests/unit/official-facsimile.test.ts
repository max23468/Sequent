import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import facsimileLayout from "../../src/domain/official-catalog/facsimile-layout.json" with { type: "json" };
import { listQuadroFields, type QuadroId } from "../../src/domain/official-catalog/catalog.ts";
import {
  createEmptyDeclaration,
  setCanonicalField,
  type DeclarationSnapshot,
} from "../../src/domain/declaration.ts";
import {
  createOfficialFacsimilePdf,
  resolveFacsimileFieldNumber,
} from "../../src/lib/server/official-facsimile.ts";
import { specialFacsimilePlacement } from "../../src/lib/server/official-facsimile-special-layout.ts";

function applied(
  declaration: DeclarationSnapshot,
  fieldId: string,
  value: string,
  entityId: string | null = null,
  occurrenceId: string | null = null,
): DeclarationSnapshot {
  return setCanonicalField(
    declaration,
    fieldId,
    value,
    "manually_corrected",
    ["fixture"],
    entityId,
    occurrenceId,
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
  it("usa i numeri stampati del modello e non la sequenza tecnica XSD", () => {
    expect(
      resolveFacsimileFieldNumber(
        "xsd:/Fornitura/Dichiarazione/QuadroEB/Modulo/Terreni/ValorePrecSucc",
      ),
    ).toBe("24");
    expect(
      resolveFacsimileFieldNumber(
        "xsd:/Fornitura/Dichiarazione/QuadroEB/Modulo/Terreni/DevoluzioneEB/Devoluzione/IdentificazioneSoggetto/Rigo",
      ),
    ).toBe("28");
    expect(
      resolveFacsimileFieldNumber(
        "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Graffati/ImmobiliGraffati/DatiCatastali/SezioneUrbana",
        2,
      ),
    ).toBe("38");
    expect(
      resolveFacsimileFieldNumber(
        "xsd:/Fornitura/Dichiarazione/QuadroEN/Modulo/Aziende/ImmobiliAziendali/Quadro",
        2,
      ),
    ).toBe("16");
    expect(
      resolveFacsimileFieldNumber(
        "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Graffati/ImmobiliGraffati/DatiCatastali/SezioneUrbana",
        4,
      ),
    ).toBeNull();
    expect(
      resolveFacsimileFieldNumber(
        "xsd:/Fornitura/Dichiarazione/QuadroEN/Modulo/Aziende/ImmobiliAziendali/Quadro",
        9,
      ),
    ).toBeNull();
    expect(
      resolveFacsimileFieldNumber(
        "xsd:/Fornitura/Dichiarazione/QuadroEL/Modulo/TerreniTavolare/LuogoTavolare/CodiceComuneAmministrativo",
      ),
    ).toBeNull();
  });

  it("blocca una dichiarazione costruita su versioni ufficiali diverse", async () => {
    const declaration = createEmptyDeclaration();
    declaration.catalogVersion = "catalogo-obsoleto";
    await expect(
      createOfficialFacsimilePdf({ ...input(declaration), subjects: [], assets: [] }),
    ).rejects.toMatchObject({ code: "VERSION_MISMATCH", fieldId: null });
  });

  it("preserva più occorrenze annidate nello stesso cespite", () => {
    const fieldId =
      "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Graffati/ImmobiliGraffati/DatiCatastali/Particella";
    let declaration = createEmptyDeclaration();
    declaration = applied(declaration, fieldId, "100", "asset-1", "graffato-1");
    declaration = applied(declaration, fieldId, "200", "asset-1", "graffato-2");
    expect(Object.values(declaration.fields).map((field) => field.value)).toEqual(["100", "200"]);
  });

  it("renderizza EH sulla mappa semantica multipagina senza usare il numero XSD come coordinata", async () => {
    const declaration = applied(
      createEmptyDeclaration(),
      "xsd:/Fornitura/Dichiarazione/QuadroEH/PrimoModulo/SezioneI_DichSost/Presentatore/Cognome",
      "ROSSI",
    );
    const bytes = await createOfficialFacsimilePdf({
      ...input(declaration),
      subjects: [],
      assets: [],
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(5);
  });

  it("qualifica ogni campo visibile non-firma di EH ed EI", () => {
    for (const quadro of ["EH", "EI"] as const)
      for (const field of listQuadroFields(quadro)) {
        if (
          field.visibleFieldId === null ||
          /\/Firma|\.firma/i.test(field.canonicalId) ||
          (quadro === "EH" && field.canonicalId.endsWith("/Luogo/CodiceComune")) ||
          (quadro === "EI" && field.canonicalId.endsWith("/Luogo/CodiceComuneAmministrativo"))
        )
          continue;
        expect(specialFacsimilePlacement(field.canonicalId), field.canonicalId).not.toBeNull();
      }
  });

  it("separa i moduli aggiuntivi EH e blocca il quarto erede nello stesso modulo", async () => {
    const fieldId =
      "xsd:/Fornitura/Dichiarazione/QuadroEH/PrimoModulo/SezioneI_DichSost/Eredi/CodiceFiscale";
    let overflowing = createEmptyDeclaration();
    for (let index = 0; index < 4; index += 1)
      overflowing = applied(
        overflowing,
        fieldId,
        `RSSMRA80A01H50${index}X`,
        null,
        `erede-${index}`,
      );
    await expect(
      createOfficialFacsimilePdf({ ...input(overflowing), subjects: [], assets: [] }),
    ).rejects.toMatchObject({ code: "FIELD_UNMAPPED", fieldId });

    const moduloField =
      "xsd:/Fornitura/Dichiarazione/QuadroEH/Modulo/SezioneI_DichSost/Aziende/CameraCommercio";
    await expect(
      createOfficialFacsimilePdf({
        ...input(applied(createEmptyDeclaration(), moduloField, "ROMA")),
        subjects: [],
        assets: [],
      }),
    ).rejects.toMatchObject({ code: "FIELD_UNMAPPED", fieldId: moduloField });
    const withContinuation = applied(
      applied(createEmptyDeclaration(), fieldId, "RSSMRA80A01H501U", null, "erede-1"),
      moduloField,
      "ROMA",
      null,
      "modulo-2",
    );
    const bytes = await createOfficialFacsimilePdf({
      ...input(withContinuation),
      subjects: [],
      assets: [],
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(9);
  });

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
    expect(pdf.getForm().getFields()).toHaveLength(0);
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

  it("non inventa caselle per i campi tecnici assenti dal frontespizio stampato", async () => {
    const declaration = applied(
      createEmptyDeclaration(),
      "xsd:/Fornitura/Dichiarazione/Frontespizio/Versamento/IBAN",
      "IT00X0000000000000000000000",
    );
    const bytes = await createOfficialFacsimilePdf({
      ...input(declaration),
      subjects: [],
      assets: [],
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
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

  it("genera tutte le pagine pertinenti dei quadri con mappa grafica qualificata", async () => {
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

  it("renderizza insieme tutti i campi qualificati senza collisioni di mappatura", async () => {
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
      const entityId = quadro === "EA" ? "subject-full" : `asset-full-${quadro}`;
      if (quadro !== "EA" && entityQuadri.has(quadro)) assets.push({ id: entityId, quadro });
      for (const field of listQuadroFields(quadro)) {
        if (
          field.visibleFieldId === null ||
          /\/Firma|\.firma/i.test(field.canonicalId) ||
          resolveFacsimileFieldNumber(field.canonicalId) === null
        )
          continue;
        declaration = setCanonicalField(
          declaration,
          field.canonicalId,
          "1",
          "manually_corrected",
          ["fixture"],
          entityQuadri.has(quadro) ? entityId : null,
          field.canonicalId.includes("/Modulo/") && !field.canonicalId.includes("/PrimoModulo/")
            ? `module-${quadro}`
            : field.occurrenceGroup
              ? `occurrence-${quadro}-${field.occurrenceGroup}`
              : null,
        );
      }
    }
    const bytes = await createOfficialFacsimilePdf({
      ...input(declaration),
      subjects: [{ id: "subject-full", sequence: 1 }],
      assets,
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(22);
  }, 90_000);
});
