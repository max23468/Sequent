import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseDgn } from "../../scripts/official-sources/qualify-suc13-control.mjs";

test("classifica separatamente errori bloccanti e avvisi del controllo SUC13", () => {
  const result = parseDgn(
    [
      "0USUC1301                                                  2.3.1   11/03/2026",
      "1RSSMRA80A01H501U043345XXX01                                                                        00001",
      "1RSSMRA80A01H501U162081                                                                             00001",
    ].join("\n"),
  );

  assert.equal(result.version, "2.3.1");
  assert.deepEqual(
    result.advisoryDiagnostics.map(({ code }) => code),
    ["3345"],
  );
  assert.deepEqual(
    result.blockingDiagnostics.map(({ code }) => code),
    ["2081"],
  );
});

test("la qualificazione versionata è legata alla fixture sintetica esatta", () => {
  const qualification = JSON.parse(
    readFileSync("src/domain/official-catalog/suc13-control-qualification.json", "utf8"),
  );
  const fixture = readFileSync(qualification.fixture.path);
  const actualHash = createHash("sha256").update(fixture).digest("hex");

  assert.equal(qualification.status, "qualified");
  assert.equal(qualification.result.accepted, true);
  assert.equal(qualification.result.blockingDiagnostics.length, 0);
  assert.equal(actualHash, qualification.fixture.sha256);
});
