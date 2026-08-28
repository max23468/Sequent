import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  readFileSync("src/domain/official-catalog/source-manifest.json", "utf8"),
);
const qualification = JSON.parse(
  readFileSync("src/domain/official-catalog/official-live-qualification.json", "utf8"),
);

test("la qualificazione dei canali vivi copre tutti i programmi e servizi operativi", () => {
  assert.equal(qualification.status, "qualified");
  assert.deepEqual(qualification.blockers, []);
  assert.ok(qualification.channels.every((channel: { localMatch: boolean }) => channel.localMatch));
  const qualifiedSources = new Set(
    qualification.channels.flatMap((channel: { sourceIds: string[] }) => channel.sourceIds),
  );
  for (let number = 30; number <= 40; number += 1) {
    const sourceId = `SRC-${String(number).padStart(2, "0")}`;
    assert.ok(qualifiedSources.has(sourceId), `${sourceId} non qualificata`);
  }
  assert.ok(qualifiedSources.has("SRC-15"));
});

test("le impronte pubblicate dall’Agenzia coincidono con gli originali locali", () => {
  for (const sourceId of ["SRC-33", "SRC-34"]) {
    const source = manifest.sources.find((candidate: { id: string }) => candidate.id === sourceId);
    assert.equal(source.officialSha256, source.sha256);
  }
  assert.ok(
    qualification.channels.find((channel: { id: string }) => channel.id === "desktop-telematico")
      .officialSha256Match,
  );
});
