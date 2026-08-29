import assert from "node:assert/strict";
import test from "node:test";
import { releaseCommitMatches, releaseNotes } from "./release.mjs";

test("estrae soltanto la voce della versione candidata", () => {
  const notes = releaseNotes(
    "# Changelog\n\n## 0.2.0 - 2026-08-29\n\n- Più veloce.\n\n## 0.1.0\n\n- Prima.\n",
    "0.2.0",
  );
  assert.equal(notes, "## Novità\n\n- Più veloce.\n");
});

test("il controllo release accetta HEAD prima del merge e origin/main dopo lo squash", () => {
  const head = "a".repeat(40);
  const main = "b".repeat(40);
  assert.equal(releaseCommitMatches({ checkOnly: true, commit: head, head, main }), true);
  assert.equal(releaseCommitMatches({ checkOnly: true, commit: main, head, main }), true);
  assert.equal(
    releaseCommitMatches({ checkOnly: true, commit: "c".repeat(40), head, main }),
    false,
  );
  assert.equal(releaseCommitMatches({ checkOnly: false, commit: head, head, main }), false);
  assert.equal(releaseCommitMatches({ checkOnly: false, commit: main, head, main }), true);
});
