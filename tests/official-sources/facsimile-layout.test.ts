import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";

test("lega il layout del fac-simile all'esatto modello ufficiale", () => {
  const manifest = JSON.parse(
    readFileSync("src/domain/official-catalog/source-manifest.json", "utf8"),
  );
  const layout = JSON.parse(
    readFileSync("src/domain/official-catalog/facsimile-layout.json", "utf8"),
  );
  const source = manifest.sources.find((candidate: { id: string }) => candidate.id === "SRC-03");
  assert.ok(source);
  const bytes = readFileSync(resolve("private/official-sources", source.alias));
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(layout.sourceId, "SRC-03");
  assert.equal(layout.sourceAlias, source.alias);
  assert.equal(layout.sourceSha256, source.sha256);
  assert.equal(digest, source.sha256);
  assert.equal(layout.sourcePages, 18);
  assert.deepEqual(layout.omittedSourcePages, [1]);
  assert.deepEqual(Object.keys(layout.quadri).sort(), [
    "EA",
    "EB",
    "EC",
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
    "ER",
  ]);
  for (const quadro of Object.values(layout.quadri) as Array<{
    bands: Array<{ page: number; top: number; bottom: number }>;
    anchors: Array<{ page: number; top: number; width: number }>;
  }>) {
    assert.ok(quadro.bands.length > 0);
    for (const anchor of quadro.anchors) {
      assert.ok(anchor.width > 0);
      assert.ok(
        quadro.bands.some(
          (band) => band.page === anchor.page && anchor.top >= band.top && anchor.top < band.bottom,
        ),
      );
    }
  }
});

test("include nell'immagine soltanto il modello ministeriale richiesto dal fac-simile", () => {
  const dockerignore = readFileSync(".dockerignore", "utf8").split("\n");
  assert.ok(dockerignore.includes("private"));
  assert.ok(dockerignore.includes("private/*"));
  assert.ok(dockerignore.includes("private/official-sources/*"));
  assert.ok(
    dockerignore.includes("!private/official-sources/modello-dichiarazione-successione-2025.pdf"),
  );
  assert.equal(
    dockerignore.filter((entry) => entry.startsWith("!private/official-sources/")).length,
    2,
  );
});
