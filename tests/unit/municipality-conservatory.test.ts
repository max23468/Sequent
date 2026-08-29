import { describe, expect, it } from "vitest";
import {
  calculateOfficialJurisdictionCounts,
  conservatoryCodeForMunicipality,
  normalizeMunicipalityCode,
  type JurisdictionAllocation,
} from "../../src/domain/municipality-conservatory.ts";

const allocation = (overrides: Partial<JurisdictionAllocation> = {}): JurisdictionAllocation => ({
  assetId: "asset-1",
  assetKind: "building",
  municipalityCode: "A001",
  provinceCode: "PD",
  relationshipCode: "01",
  rightCode: "1",
  reliefCode: "",
  ...overrides,
});

describe("mappa ufficiale Comune-conservatoria", () => {
  it("normalizza le sezioni comunali come il controllo Sogei", () => {
    expect(normalizeMunicipalityCode("A001A")).toBe("A001");
    expect(normalizeMunicipalityCode("G831A")).toBe("G831A");
    expect(conservatoryCodeForMunicipality("A001A")).toBe("PD00");
    expect(conservatoryCodeForMunicipality("G831A")).toBeNull();
    expect(conservatoryCodeForMunicipality("ZZZZ")).toBeUndefined();
  });

  it("conta conservatorie distinte, non beni o Comuni", () => {
    const result = calculateOfficialJurisdictionCounts(
      [
        allocation(),
        allocation({ assetId: "asset-2", municipalityCode: "A075" }),
        allocation({ assetId: "asset-3", municipalityCode: "A010", provinceCode: "MI" }),
      ],
      "first",
    );
    expect(result).toMatchObject({
      mortgage: 2,
      stampDuty: 2,
      mortgageMaximum: 2,
      stampDutyMaximum: 2,
      mode: "automatic",
      unresolvedMunicipalityCodes: [],
    });
  });

  it("applica separatamente le esclusioni ufficiali di tassa ipotecaria e bollo", () => {
    const result = calculateOfficialJurisdictionCounts(
      [
        allocation({ assetId: "mortgage-excluded", relationshipCode: "36" }),
        allocation({ assetId: "mortgage-excluded", relationshipCode: "01" }),
        allocation({ assetId: "stamp-share-excluded", relationshipCode: "37" }),
        allocation({ assetId: "stamp-share-excluded", relationshipCode: "01" }),
        allocation({ assetId: "asset-relief-h", reliefCode: "H" }),
      ],
      "first",
    );
    expect(result.mortgage).toBe(1);
    expect(result.stampDuty).toBe(1);
  });

  it("ignora estero e tavolare e segnala i codici amministrativi sconosciuti", () => {
    const result = calculateOfficialJurisdictionCounts(
      [
        allocation({ assetId: "foreign", provinceCode: "EE", municipalityCode: "ZZZZ" }),
        allocation({ assetId: "tavolare", municipalityCode: "G831A", provinceCode: "UD" }),
        allocation({ assetId: "unknown", municipalityCode: "ZZZZ" }),
      ],
      "first",
    );
    expect(result).toMatchObject({ mortgage: 0, stampDuty: 0 });
    expect(result.unresolvedMunicipalityCodes).toEqual(["ZZZZ"]);
  });

  it("azzera la sostitutiva 2 e limita la sostitutiva 1 al massimo calcolato", () => {
    const allocations = [
      allocation(),
      allocation({ assetId: "asset-2", municipalityCode: "A010", provinceCode: "MI" }),
    ];
    expect(calculateOfficialJurisdictionCounts(allocations, "substitute-2")).toMatchObject({
      mortgage: 0,
      stampDuty: 0,
      mode: "automatic",
    });
    expect(
      calculateOfficialJurisdictionCounts(allocations, "substitute-1", {
        mortgage: 1,
        stampDuty: 2,
      }),
    ).toMatchObject({
      mortgage: 1,
      stampDuty: 2,
      mortgageMaximum: 2,
      stampDutyMaximum: 2,
      mode: "professional-input",
    });
    expect(
      calculateOfficialJurisdictionCounts(allocations, "substitute-1", {
        mortgage: 3,
        stampDuty: -1,
      }),
    ).toMatchObject({
      mortgage: 0,
      stampDuty: 0,
      declaredCountStatus: { mortgage: "above-maximum", stampDuty: "invalid" },
    });
  });
});
