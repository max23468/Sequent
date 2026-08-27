import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  checkState,
  localGateCommands,
  operationalClassification,
  PRE_REVIEW_CHECKS,
  prBody,
  publicationScope,
  remoteDeletionFailed,
  selectWorkflowRun,
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

test("Pubblica include candidata e deploy soltanto quando applicabili", () => {
  const governance = publicationScope({ runtime: false });
  assert.deepEqual(governance, {
    runtime: false,
    releaseCandidate: false,
    deploy: false,
    firstActivationRequired: false,
  });

  const beforeActivation = publicationScope({ runtime: true });
  assert.equal(beforeActivation.releaseCandidate, true);
  assert.equal(beforeActivation.deploy, false);
  assert.equal(beforeActivation.firstActivationRequired, true);

  const active = publicationScope(
    { runtime: true },
    { productionActive: true, productionWorkflowAvailable: true },
  );
  assert.equal(active.releaseCandidate, true);
  assert.equal(active.deploy, true);
  assert.equal(active.firstActivationRequired, false);
});

test("con una Production attiva classifica il diff cumulativo dall'ultimo deploy", () => {
  const prClassification = { runtime: false, level: "rapid" };
  const calls = [];
  const cumulative = operationalClassification(
    prClassification,
    "a".repeat(40),
    "HEAD",
    (base, head) => {
      calls.push([base, head]);
      return ["src/lib/format.ts"];
    },
  );
  assert.deepEqual(calls, [["a".repeat(40), "HEAD"]]);
  assert.equal(cumulative.runtime, true);
});

test("il corpo PR non dichiara più release e deploy sempre assenti", () => {
  const body = prBody(
    { level: "ordinary", runtime: true, runBrowser: false, runArm64: false },
    publicationScope({ runtime: true }),
  );
  assert.match(body, /Impatto runtime: sì/);
  assert.match(body, /Candidata di release: inclusa/);
  assert.match(body, /prima attivazione separata/);
  assert.doesNotMatch(body, /Deploy o release richiesti: no/);
});

test("il contratto Pubblica autorizza il ciclo applicabile ma non la prima attivazione", async () => {
  const agents = await readFile(new URL("../../AGENTS.md", import.meta.url), "utf8");
  assert.match(agents, /autorizza l'intero ciclo tecnico applicabile/);
  assert.match(agents, /deploy tecnico e verifica live quando applicabili/);
  assert.match(agents, /prima attivazione stabile.*richiesta esplicita separata/s);
  assert.doesNotMatch(agents, /Pubblicare su GitHub non autorizza deploy, release/);
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

test("considera riuscita la cancellazione concorrente del branch remoto", () => {
  assert.equal(remoteDeletionFailed({ deletionStatus: 1, existsAfter: false }), false);
  assert.equal(remoteDeletionFailed({ deletionStatus: 1, existsAfter: true }), true);
  assert.equal(remoteDeletionFailed({ deletionStatus: 0, existsAfter: false }), false);
});

test("lega il dispatch alla run con titolo e finestra corretti", () => {
  const selected = selectWorkflowRun(
    [
      {
        databaseId: 1,
        displayTitle: "Release candidate abc",
        createdAt: "2026-08-27T09:59:00Z",
      },
      {
        databaseId: 2,
        displayTitle: "Release candidate def",
        createdAt: "2026-08-27T10:00:01Z",
      },
      {
        databaseId: 3,
        displayTitle: "Release candidate abc",
        createdAt: "2026-08-27T10:00:02Z",
      },
    ],
    "Release candidate abc",
    "2026-08-27T10:00:00Z",
  );
  assert.equal(selected.databaseId, 3);
});
