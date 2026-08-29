import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OPERATIONAL_AREAS,
  OPERATIONAL_SECTION_AREAS,
  buildOperationalParityMap,
  isOperationalParityEditable,
  listOperationalAreaFields,
  type OperationalParityRow,
} from "../../src/domain/operational-parity.ts";
import { QUADRI, listQuadroFields } from "../../src/domain/official-catalog/catalog.ts";

const checkedInMap = JSON.parse(
  readFileSync("src/domain/official-catalog/operational-view-parity.json", "utf8"),
) as OperationalParityRow[];

describe("mappatura della parità informativa", () => {
  it("registra una riga per ciascuno dei 715 campi visibili", () => {
    const visibleFields = QUADRI.flatMap((quadro) =>
      listQuadroFields(quadro).filter((field) => field.visibleFieldId !== null),
    );
    expect(visibleFields).toHaveLength(715);
    expect(checkedInMap).toHaveLength(visibleFields.length);
    expect(new Set(checkedInMap.map((row) => row.fieldId)).size).toBe(checkedInMap.length);
    expect(checkedInMap.map((row) => row.fieldId).sort()).toEqual(
      visibleFields.map((field) => field.canonicalId).sort(),
    );
  });

  it("mantiene la matrice versionata uguale alla generazione deterministica", () => {
    expect(checkedInMap).toEqual(buildOperationalParityMap());
  });

  it("non lascia campi senza oggetto, destinazione, applicabilità o test di parità", () => {
    for (const row of checkedInMap) {
      expect(row.professionalObject).not.toBe("");
      expect(OPERATIONAL_AREAS).toContain(row.candidateOperationalArea);
      expect(row.candidateContext).not.toBe("");
      expect(row.semanticReview.reason).not.toBe("");
      expect(row.semanticReview.provenance.length).toBeGreaterThan(0);
      expect(["definitiva", "non-definitiva"]).toContain(row.destinationReview.uiDecision);
      expect(row.applicability.declarationKinds.length).toBeGreaterThan(0);
      expect(row.requiredParityTests.length).toBeGreaterThan(0);
      expect(row.cardinality.entityScope).toMatch(
        /^(decedent|subject|asset|occurrence|declaration)$/,
      );
    }
    for (const area of OPERATIONAL_AREAS)
      expect(checkedInMap.some((row) => row.candidateOperationalArea === area)).toBe(true);
  });

  it("separa modalità qualificate, proposte e blocker senza riusare il default editabile", () => {
    const handlingCounts = Object.fromEntries(
      [null, "inserito", "derivato", "gestito-automaticamente"].map((handling) => [
        handling ?? "non-determinato",
        checkedInMap.filter((row) => row.handling === handling).length,
      ]),
    );
    const reviewCounts = Object.fromEntries(
      ["qualificata", "candidata", "irrisolta"].map((status) => [
        status,
        checkedInMap.filter((row) => row.semanticReview.status === status).length,
      ]),
    );
    expect(handlingCounts).toEqual({
      "non-determinato": 34,
      inserito: 637,
      derivato: 5,
      "gestito-automaticamente": 39,
    });
    expect(reviewCounts).toEqual({ qualificata: 458, candidata: 223, irrisolta: 34 });
    expect(
      checkedInMap
        .filter((row) => row.semanticReview.status === "irrisolta")
        .every(
          (row) =>
            row.handling === null &&
            row.semanticReview.blocker !== null &&
            row.requiredParityTests.includes("qualificazione-semantica-bloccante"),
        ),
    ).toBe(true);
  });

  it("qualifica formule e sottoscrizioni, ma blocca caselle quadro, servizio e importi senza fonte", () => {
    const eeRows = checkedInMap.filter((row) => row.quadro === "EE");
    expect(eeRows).toHaveLength(8);
    expect(
      eeRows.every(
        (row) =>
          row.handling === "gestito-automaticamente" &&
          row.semanticReview.status === "qualificata" &&
          row.handlingBasis === "official-deterministic-rule",
      ),
    ).toBe(true);

    const signatures = checkedInMap.filter((row) => row.semanticCategory === "sottoscrizione");
    expect(signatures).toHaveLength(11);
    expect(
      signatures.every(
        (row) => row.handling === "inserito" && row.semanticReview.status === "qualificata",
      ),
    ).toBe(true);

    const compiledQuadroBoxes = checkedInMap.filter((row) =>
      row.technicalPath.includes("/FirmaModello/Casella"),
    );
    expect(compiledQuadroBoxes).toHaveLength(16);
    expect(
      compiledQuadroBoxes.every(
        (row) => row.handling === null && row.semanticReview.status === "irrisolta",
      ),
    ).toBe(true);

    const serviceFields = checkedInMap.filter(
      (row) =>
        row.technicalPath.includes("/CampiServizio/") ||
        row.technicalPath.endsWith("/IdentificativoProdSoftware"),
    );
    expect(serviceFields).toHaveLength(5);
    expect(serviceFields.every((row) => row.destinationReview.status === "irrisolta")).toBe(true);
  });

  it("conferma le destinazioni professionali e lascia irrisolti soltanto i dati di servizio", () => {
    expect(
      checkedInMap
        .filter((row) => row.destinationReview.uiDecision === "definitiva")
        .every(
          (row) =>
            row.destinationReview.status === "qualificata" &&
            row.destinationReview.blocker === null,
        ),
    ).toBe(true);
    expect(
      checkedInMap.filter((row) => row.destinationReview.uiDecision === "non-definitiva"),
    ).toHaveLength(5);
    expect(
      Object.fromEntries(
        OPERATIONAL_AREAS.map((area) => [
          area,
          checkedInMap.filter((row) => row.candidateOperationalArea === area).length,
        ]),
      ),
    ).toEqual({
      Panoramica: 29,
      Documenti: 11,
      Persone: 116,
      Patrimonio: 295,
      Devoluzione: 120,
      "Imposte e pagamenti": 101,
      "Controlli finali": 13,
      "Riepilogo finale": 30,
    });
  });

  it("qualifica i 207 campi EH come snapshot isolati della dichiarazione selezionata", () => {
    const ehRows = checkedInMap.filter((row) => row.quadro === "EH");
    expect(ehRows).toHaveLength(207);
    expect(ehRows.filter((row) => row.cardinality.entityScope === "declaration")).toHaveLength(128);
    expect(ehRows.filter((row) => row.cardinality.entityScope === "occurrence")).toHaveLength(79);
    expect(
      ehRows.every(
        (row) =>
          row.declarationIdentity.owner === "snapshot-della-dichiarazione-selezionata" &&
          row.declarationIdentity.ehMeaning === "quadro-EH-della-dichiarazione-selezionata" &&
          row.declarationIdentity.successiveDeclarationBehavior ===
            "copiato-alla-creazione-poi-isolato" &&
          row.declarationIdentity.liveReferenceToSourceDeclaration === false &&
          row.declarationIdentity.identityDimensions.includes("declarationId") &&
          row.declarationIdentity.identityDimensions.includes("fieldId") &&
          row.declarationIdentity.review.status === "qualificata",
      ),
    ).toBe(true);
    expect(
      ehRows
        .filter((row) => row.cardinality.entityScope === "occurrence")
        .every((row) => row.declarationIdentity.identityDimensions.includes("occurrenceId")),
    ).toBe(true);
  });

  it("deriva la copertura dalla superficie operativa corrente senza dichiarare una falsa parità", () => {
    const counts = Object.fromEntries(
      ["coperto", "parziale", "mancante"].map((status) => [
        status,
        checkedInMap.filter((row) => row.currentCoverage === status).length,
      ]),
    );
    expect(counts).toEqual({ coperto: 419, parziale: 291, mancante: 5 });
    expect(
      checkedInMap
        .filter((row) => row.currentCoverage === "coperto")
        .every(
          (row) =>
            row.operationalVisibility === "esatta" &&
            (row.operationalEditability === "completa" || row.handling === "derivato"),
        ),
    ).toBe(true);
    expect(
      checkedInMap
        .filter((row) => row.operationalEditability === "completa")
        .every((row) => isOperationalParityEditable(row)),
    ).toBe(true);
    expect(
      checkedInMap
        .filter((row) => row.currentCoverage === "mancante")
        .every((row) => row.destinationReview.uiDecision === "non-definitiva"),
    ).toBe(true);
    expect(checkedInMap.every((row) => row.coverageReason.length > 0)).toBe(true);
  });

  it("classifica Dati da verificare e Cronologia come superfici trasversali, non destinazioni", () => {
    expect(OPERATIONAL_AREAS).not.toContain("Dati da verificare");
    expect(OPERATIONAL_AREAS).not.toContain("Cronologia");
  });

  it("espone nelle otto aree i 710 campi con destinazione UI definitiva", () => {
    expect(Object.keys(OPERATIONAL_SECTION_AREAS)).toEqual([
      "overview",
      "documents",
      "people",
      "estate",
      "devolution",
      "taxes",
      "checks",
      "final",
    ]);
    const exposed = OPERATIONAL_AREAS.flatMap(listOperationalAreaFields);
    expect(exposed).toHaveLength(710);
    expect(new Set(exposed.map((field) => field.canonicalId)).size).toBe(exposed.length);
    expect(
      exposed.every(
        (field) =>
          field.operationalParity.fieldId === field.canonicalId &&
          field.operationalParity.destinationReview.uiDecision === "definitiva",
      ),
    ).toBe(true);
    expect(
      exposed.filter((field) => isOperationalParityEditable(field.operationalParity)),
    ).toHaveLength(414);
  });
});
