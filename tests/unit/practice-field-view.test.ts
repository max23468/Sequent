import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listOperationalAreaFields } from "../../src/domain/operational-parity.ts";
import { createPracticeFieldView } from "../../src/lib/server/practice-field-view.ts";

describe("DTO dei campi della pratica", () => {
  it("non invia al browser provenienza tecnica ed evidenze di sviluppo", () => {
    const source = listOperationalAreaFields("Patrimonio");
    const fields = source.map((field) => createPracticeFieldView(field, field.operationalParity));
    const serialized = JSON.stringify(fields);

    expect(serialized).not.toContain("requiredParityTests");
    expect(serialized).not.toContain("currentEvidence");
    expect(serialized).not.toContain("sourcePointer");
    expect(serialized).not.toContain("technicalPath");
    expect(fields[0]?.operationalParity.applicability.xsdPresence).toBeDefined();
    expect(fields[0]?.operationalParity.cardinality.effectiveMin).toBeDefined();
    expect(Buffer.byteLength(serialized)).toBeLessThan(350_000);
  });

  it("mantiene i predicate client separati dal catalogo ministeriale", () => {
    for (const component of [
      "src/lib/components/OfficialFieldControl.svelte",
      "src/lib/components/OfficialFieldGroup.svelte",
      "src/lib/components/OperationalFieldGroup.svelte",
    ]) {
      expect(readFileSync(component, "utf8")).toContain("operational-parity-shared");
      expect(readFileSync(component, "utf8")).not.toMatch(/operational-parity["']/);
    }
  });
});
