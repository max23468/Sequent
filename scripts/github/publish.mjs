#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { classifyChangedFiles, changedFiles } from "./publication-policy.mjs";

export const PRE_REVIEW_CHECKS = [
  "Foundation",
  "Dependency review",
  "Analyze (javascript-typescript)",
  "PR gate",
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} non riuscito`);
}

function output(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function json(command, args) {
  return JSON.parse(output(command, args));
}

export function localGateCommands(classification) {
  if (classification.level === "rapid") return [["npm", ["run", "verify:rapid"]]];
  const commands = [
    ["npm", ["run", "verify:public"]],
    ["npm", ["run", "doctor"]],
  ];
  if (classification.runBrowser) commands.push(["npm", ["run", "test:e2e"]]);
  return commands;
}

export function checkState(statusCheckRollup, required = PRE_REVIEW_CHECKS) {
  const states = new Map(
    statusCheckRollup.map((check) => [
      check.name ?? check.context,
      check.conclusion || check.state || check.status,
    ]),
  );
  const failed = required.filter((name) =>
    ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"].includes(states.get(name)),
  );
  const pending = required.filter((name) => !["SUCCESS", "SKIPPED"].includes(states.get(name)));
  return { failed, pending };
}

export function shouldRequestCodex({ comments, resetAt, statusState }) {
  if (statusState === "success") return false;
  return !comments.some(
    (comment) =>
      ["OWNER", "MEMBER", "COLLABORATOR"].includes(comment.author_association) &&
      /^\s*@codex\s+review\s*$/i.test(comment.body) &&
      new Date(comment.created_at).getTime() >= new Date(resetAt ?? 0).getTime(),
  );
}

export async function waitForPrHead(
  readPr,
  headSha,
  { attempts = 12, intervalMs = 5_000, pause = sleep } = {},
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const pr = readPr();
    if (pr.headRefOid === headSha) return pr;
    if (attempt < attempts) await pause(intervalMs);
  }
  throw new Error("La PR non punta all'HEAD locale verificato");
}

async function waitForChecks(prNumber, required, timeoutMinutes = 30) {
  const deadline = Date.now() + timeoutMinutes * 60_000;
  while (Date.now() < deadline) {
    const pr = json("gh", ["pr", "view", String(prNumber), "--json", "statusCheckRollup"]);
    const state = checkState(pr.statusCheckRollup, required);
    if (state.failed.length) throw new Error(`Check falliti: ${state.failed.join(", ")}`);
    if (!state.pending.length) return;
    console.log(`In attesa di: ${state.pending.join(", ")}`);
    await sleep(15_000);
  }
  throw new Error("Timeout durante l'attesa dei check GitHub");
}

async function waitForCodex(prNumber) {
  const deadline = Date.now() + 5 * 60 * 60_000;
  while (Date.now() < deadline) {
    const pr = json("gh", ["pr", "view", String(prNumber), "--json", "statusCheckRollup"]);
    const status = pr.statusCheckRollup.find(
      (check) => (check.context ?? check.name) === "codex-review",
    );
    const state = status?.state ?? status?.conclusion;
    if (state === "SUCCESS") return;
    if (["FAILURE", "ERROR"].includes(state)) throw new Error(`codex-review: ${state}`);
    console.log("In attesa della review Codex exact-HEAD");
    await sleep(30_000);
  }
  throw new Error("Timeout durante l'attesa della review Codex");
}

function ensureLocalPreconditions(branch) {
  if (branch === "main") throw new Error("La pubblicazione richiede un branch breve, non main");
  if (output("git", ["status", "--porcelain"])) throw new Error("Working tree non pulita");
  run("git", ["fetch", "origin", "--prune"]);
  run("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"]);
}

function prBody(classification) {
  return `## Sintesi

Pubblicazione GitHub classificata automaticamente come **${classification.level}**.

## Verifiche

- [x] Preflight locale proporzionato
- [ ] Gate GitHub pertinenti
- [ ] Review Codex exact-HEAD
- [ ] P2/P3 registrati; thread umani preservati
- [ ] Nessun dato reale, fonte originale o segreto aggiunto

## Impatto operativo

- Deploy o release richiesti: no
- Browser richiesto: ${classification.runBrowser ? "sì" : "no"}
- ARM64 richiesto: ${classification.runArm64 ? "sì" : "no"}

## Rischi e rollback

Rollback tramite revert dello squash merge; nessuna mutazione di dati operativi.`;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const branch = output("git", ["branch", "--show-current"]);
  ensureLocalPreconditions(branch);
  const headSha = output("git", ["rev-parse", "HEAD"]);
  const headTree = output("git", ["rev-parse", "HEAD^{tree}"]);
  const classification = classifyChangedFiles(changedFiles("origin/main", "HEAD"));
  console.log(JSON.stringify(classification, null, 2));

  for (const [command, args] of localGateCommands(classification)) run(command, args);
  if (!execute) {
    console.log("Preflight completato. Usa --execute soltanto con autorizzazione a pubblicare.");
    return;
  }

  run("git", ["push", "--set-upstream", "origin", branch]);
  const repository = json("gh", ["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  let pr;
  let createdPr = false;
  try {
    pr = json("gh", ["pr", "view", branch, "--json", "number,headRefOid"]);
  } catch {
    const title = output("git", ["log", "-1", "--format=%s"]);
    run("gh", [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      title,
      "--body",
      prBody(classification),
    ]);
    pr = json("gh", ["pr", "view", branch, "--json", "number,headRefOid"]);
    createdPr = true;
  }
  pr = await waitForPrHead(
    () => json("gh", ["pr", "view", branch, "--json", "number,headRefOid"]),
    headSha,
  );

  await waitForChecks(pr.number, PRE_REVIEW_CHECKS);
  if (!createdPr) {
    const combinedStatus = json("gh", ["api", `repos/${repository}/commits/${headSha}/status`]);
    const codexStatus = combinedStatus.statuses
      .filter((status) => status.context === "codex-review")
      .sort(
        (left, right) =>
          new Date(right.updated_at ?? right.created_at).getTime() -
          new Date(left.updated_at ?? left.created_at).getTime(),
      )[0];
    const comments = json("gh", ["api", `repos/${repository}/issues/${pr.number}/comments`]);
    if (
      shouldRequestCodex({
        comments,
        resetAt: codexStatus?.updated_at ?? codexStatus?.created_at,
        statusState: codexStatus?.state,
      })
    ) {
      run("gh", [
        "api",
        `repos/${repository}/issues/${pr.number}/comments`,
        "--field",
        "body=@codex review",
      ]);
    }
  }
  await waitForCodex(pr.number);
  await waitForChecks(pr.number, [...PRE_REVIEW_CHECKS, "codex-review"]);

  run("gh", ["pr", "merge", String(pr.number), "--squash", "--match-head-commit", headSha]);
  const branchStillRemote = spawnSync("git", [
    "ls-remote",
    "--exit-code",
    "--heads",
    "origin",
    branch,
  ]);
  if (branchStillRemote.status === 0) run("git", ["push", "origin", "--delete", branch]);
  run("git", ["fetch", "origin", "--prune"]);
  const mainTree = output("git", ["rev-parse", "origin/main^{tree}"]);
  if (mainTree !== headTree) throw new Error("L'albero di origin/main diverge dall'HEAD approvato");
  const merged = json("gh", [
    "pr",
    "view",
    String(pr.number),
    "--json",
    "state,mergedAt,mergeCommit",
  ]);
  if (merged.state !== "MERGED") throw new Error("La PR non risulta merged alla rilettura finale");
  const remoteBranch = spawnSync("git", ["ls-remote", "--exit-code", "--heads", "origin", branch]);
  if (remoteBranch.status === 0)
    throw new Error("Il branch remoto temporaneo non è stato eliminato");
  if (output("git", ["status", "--porcelain"]))
    throw new Error("Working tree non pulita dopo il merge");

  run("node", ["scripts/github/reconcile-ruleset.mjs", "--apply"]);
  console.log(
    JSON.stringify(
      { pullRequest: pr.number, mergeCommit: merged.mergeCommit?.oid, mainTree },
      null,
      2,
    ),
  );
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) await main();
