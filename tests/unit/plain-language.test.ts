import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const userFacingFiles = [
  "src/routes/+page.svelte",
  "src/routes/pratiche/[id]/+page.svelte",
  "src/routes/pratiche/[id]/riepilogo/+page.svelte",
  "src/routes/impostazioni/+page.svelte",
  "src/routes/__design/+page.svelte",
  "src/lib/components/CodexRunHistory.svelte",
  "src/lib/components/DocumentSourcePanel.svelte",
  "src/lib/components/PracticeContextPanel.svelte",
  "src/lib/components/PracticeDomainSection.svelte",
  "src/lib/components/QuadroFields.svelte",
  "src/lib/components/QuadroReferences.svelte",
  "src/lib/server/codex-capability.ts",
];

describe("linguaggio professionale dell’interfaccia", () => {
  it("non espone gergo di implementazione nei percorsi ordinari", () => {
    const forbidden = [
      /run precedenti/iu,
      /source bundle/iu,
      /ruleset/iu,
      /pipeline documentale/iu,
      /flusso ufficiale diz/iu,
      /identità configurazione/iu,
      /struttura informatica/iu,
      /specifiche suc13/iu,
      /\bruntime\b/iu,
      /\bCLI\b/iu,
      /\bSDK\b/iu,
      /codex login/iu,
      /\bVPS\b/iu,
    ];
    for (const file of userFacingFiles) {
      const source = readFileSync(resolve(file), "utf8");
      for (const expression of forbidden)
        expect(source, `${file}: ${expression}`).not.toMatch(expression);
    }
  });
});
