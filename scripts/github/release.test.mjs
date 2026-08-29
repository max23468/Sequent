import assert from "node:assert/strict";
import test from "node:test";
import { releaseNotes } from "./release.mjs";

test("estrae soltanto la voce della versione candidata", () => {
  const notes = releaseNotes(
    "# Changelog\n\n## 0.2.0 - 2026-08-29\n\n- Più veloce.\n\n## 0.1.0\n\n- Prima.\n",
    "0.2.0",
  );
  assert.equal(notes, "## Novità\n\n- Più veloce.\n");
});
