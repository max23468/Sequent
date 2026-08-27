import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  checkState,
  localGateCommands,
  PRE_REVIEW_CHECKS,
  shouldRequestCodex,
  waitForPrHead,
} from "./publish.mjs";

test("il preflight rapido non esegue suite applicative complete", () => {
  assert.deepEqual(localGateCommands({ level: "rapid" }), [["npm", ["run", "verify:rapid"]]]);
});

test("il preflight sensibile aggiunge browser soltanto quando richiesto", () => {
  assert.deepEqual(localGateCommands({ level: "sensitive", runBrowser: false }), [
    ["npm", ["run", "verify:public"]],
    ["npm", ["run", "doctor"]],
  ]);
  assert.equal(localGateCommands({ level: "sensitive", runBrowser: true }).length, 3);
});

test("attende tutti i check preliminari e fallisce presto sui rossi", () => {
  const success = PRE_REVIEW_CHECKS.map((name) => ({ name, conclusion: "SUCCESS" }));
  assert.deepEqual(checkState(success), { failed: [], pending: [] });
  const pending = checkState(success.slice(1));
  assert.deepEqual(pending.pending, [PRE_REVIEW_CHECKS[0]]);
  const failed = checkState([{ name: PRE_REVIEW_CHECKS[0], conclusion: "FAILURE" }]);
  assert.deepEqual(failed.failed, [PRE_REVIEW_CHECKS[0]]);
});

test("non duplica l'invocazione Codex per lo stesso reset dell'HEAD", () => {
  const resetAt = "2026-08-27T10:00:00Z";
  assert.equal(
    shouldRequestCodex({
      resetAt,
      statusState: "pending",
      comments: [
        {
          author_association: "OWNER",
          body: "@codex review",
          created_at: "2026-08-27T10:00:01Z",
        },
      ],
    }),
    false,
  );
  assert.equal(shouldRequestCodex({ resetAt, statusState: "success", comments: [] }), false);
  assert.equal(shouldRequestCodex({ resetAt, statusState: "pending", comments: [] }), true);
});

test("attende che GitHub esponga il nuovo HEAD della PR", async () => {
  const snapshots = [
    { number: 17, headRefOid: "old" },
    { number: 17, headRefOid: "new" },
  ];
  const pauses = [];
  const pr = await waitForPrHead(() => snapshots.shift(), "new", {
    attempts: 2,
    intervalMs: 10,
    pause: (milliseconds) => pauses.push(milliseconds),
  });

  assert.equal(pr.headRefOid, "new");
  assert.deepEqual(pauses, [10]);
});

test("invia l'invocazione Codex esatta come campo raw", async () => {
  const source = await readFile(new URL("./publish.mjs", import.meta.url), "utf8");
  assert.match(source, /"--raw-field",\s*"body=@codex review"/);
  assert.doesNotMatch(source, /"--field",\s*"body=@codex review"/);
});
