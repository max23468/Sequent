#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

export const remoteDeletionFailed = ({ deletionStatus, existsAfter }) =>
  deletionStatus !== 0 && existsAfter;

export function publicationScope(
  classification,
  { productionActive = false, productionWorkflowAvailable = false } = {},
) {
  const runtime = Boolean(classification.runtime);
  return {
    runtime,
    releaseCandidate: runtime,
    deploy: runtime && productionActive && productionWorkflowAvailable,
    firstActivationRequired: runtime && !productionActive,
  };
}

export function operationalClassification(
  prClassification,
  deployedBase,
  candidate = "HEAD",
  readChangedFiles = changedFiles,
) {
  return deployedBase
    ? classifyChangedFiles(readChangedFiles(deployedBase, candidate))
    : prClassification;
}

function remoteBranchExists(branch) {
  return spawnSync("git", ["ls-remote", "--exit-code", "--heads", "origin", branch]).status === 0;
}

function deleteRemoteBranch(branch) {
  if (!remoteBranchExists(branch)) return;
  const deletion = spawnSync("git", ["push", "origin", "--delete", branch], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (
    remoteDeletionFailed({
      deletionStatus: deletion.status,
      existsAfter: remoteBranchExists(branch),
    })
  ) {
    throw new Error(`Eliminazione del branch remoto ${branch} non riuscita`);
  }
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

export function selectWorkflowRun(runs, displayTitle, notBefore) {
  return runs
    .filter(
      (item) =>
        item.displayTitle === displayTitle &&
        new Date(item.createdAt).getTime() >= new Date(notBefore).getTime() - 5_000,
    )
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))[0];
}

async function waitForWorkflowRun(workflow, displayTitle, notBefore) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const runs = json("gh", [
      "run",
      "list",
      "--workflow",
      workflow,
      "--event",
      "workflow_dispatch",
      "--limit",
      "30",
      "--json",
      "databaseId,displayTitle,createdAt,status,conclusion,url",
    ]);
    const selected = selectWorkflowRun(runs, displayTitle, notBefore);
    if (selected) return selected;
    if (attempt < 30) await sleep(2_000);
  }
  throw new Error(`Run ${displayTitle} non rilevata dopo il dispatch`);
}

async function dispatchAndWait(workflow, displayTitle, fields) {
  const dispatchedAt = new Date().toISOString();
  const args = ["workflow", "run", workflow, "--ref", "main"];
  for (const [name, value] of Object.entries(fields)) args.push("--field", `${name}=${value}`);
  run("gh", args);
  const workflowRun = await waitForWorkflowRun(workflow, displayTitle, dispatchedAt);
  run("gh", ["run", "watch", String(workflowRun.databaseId), "--exit-status"]);
  return workflowRun;
}

function latestSuccessfulProductionDeployment(repository) {
  const deployments = json("gh", [
    "api",
    `repos/${repository}/deployments?environment=Production&task=sequent-production&per_page=100`,
  ]);
  return deployments.find((deployment) => {
    const statuses = json("gh", [
      "api",
      `repos/${repository}/deployments/${deployment.id}/statuses?per_page=1`,
    ]);
    return statuses[0]?.state === "success";
  });
}

function ensureLocalPreconditions(branch) {
  if (branch === "main") throw new Error("La pubblicazione richiede un branch breve, non main");
  if (output("git", ["status", "--porcelain"])) throw new Error("Working tree non pulita");
  run("git", ["fetch", "origin", "--prune"]);
  run("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"]);
}

export function prBody(classification, scope = publicationScope(classification)) {
  const deploy = scope.runtime
    ? scope.firstActivationRequired
      ? "prima attivazione separata; candidata di release inclusa"
      : scope.deploy
        ? "incluso dopo la candidata qualificata"
        : "bloccato: workflow Production assente"
    : "non applicabile";
  return `## Sintesi

Pubblicazione GitHub classificata automaticamente come **${classification.level}**.

## Verifiche

- [x] Preflight locale proporzionato
- [ ] Gate GitHub pertinenti
- [ ] Review Codex exact-HEAD
- [ ] P2/P3 registrati; thread umani preservati
- [ ] Nessun dato reale, documento cliente o segreto aggiunto; le sole fonti originali presenti sono pubbliche e dichiarate dal manifest

## Impatto operativo

- Impatto runtime: ${scope.runtime ? "sì" : "no"}
- Candidata di release: ${scope.releaseCandidate ? "inclusa" : "non applicabile"}
- Deploy: ${deploy}
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
  const prClassification = classifyChangedFiles(changedFiles("origin/main", "HEAD"));
  console.log(JSON.stringify(prClassification, null, 2));

  for (const [command, args] of localGateCommands(prClassification)) run(command, args);
  if (!execute) {
    console.log("Preflight completato. Usa --execute soltanto con autorizzazione a pubblicare.");
    return;
  }

  const repository = json("gh", ["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  const productionDeployment = latestSuccessfulProductionDeployment(repository);
  const productionActive = Boolean(productionDeployment);
  const classification = operationalClassification(
    prClassification,
    productionDeployment?.sha ?? null,
  );
  const productionWorkflowAvailable = existsSync(".github/workflows/production.yml");
  const scope = publicationScope(classification, {
    productionActive,
    productionWorkflowAvailable,
  });
  if (scope.runtime && productionActive && !productionWorkflowAvailable) {
    throw new Error("Runtime attivo ma workflow Production assente: pubblicazione incompleta");
  }

  run("git", ["push", "--set-upstream", "origin", branch]);
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
      prBody(classification, scope),
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
        "--raw-field",
        "body=@codex review",
      ]);
    }
  }
  await waitForCodex(pr.number);
  run("node", [
    "scripts/github/resolve-advisories.mjs",
    "--repository",
    repository,
    "--pull-request",
    String(pr.number),
    "--head",
    headSha,
  ]);
  await waitForChecks(pr.number, [...PRE_REVIEW_CHECKS, "codex-review"]);

  run("gh", ["pr", "merge", String(pr.number), "--squash", "--match-head-commit", headSha]);
  deleteRemoteBranch(branch);
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
  const mergeCommit = merged.mergeCommit?.oid;
  if (!/^[0-9a-f]{40}$/.test(mergeCommit ?? "")) {
    throw new Error("SHA dello squash merge assente o non valido");
  }
  if (remoteBranchExists(branch))
    throw new Error("Il branch remoto temporaneo non è stato eliminato");
  if (output("git", ["status", "--porcelain"]))
    throw new Error("Working tree non pulita dopo il merge");

  run("node", ["scripts/github/reconcile-ruleset.mjs", "--apply"]);
  let releaseCandidateRun = null;
  let productionRun = null;
  if (scope.releaseCandidate) {
    releaseCandidateRun = await dispatchAndWait(
      "release-candidate.yml",
      `Release candidate ${mergeCommit}`,
      { commit: mergeCommit },
    );
  }
  if (scope.deploy) {
    productionRun = await dispatchAndWait("production.yml", `Production ${mergeCommit}`, {
      commit: mergeCommit,
      release_run: releaseCandidateRun.databaseId,
    });
  } else if (scope.firstActivationRequired) {
    console.log(
      "Deploy non eseguito: la prima attivazione Production richiede autorizzazione separata.",
    );
  }
  console.log(
    JSON.stringify(
      {
        pullRequest: pr.number,
        mergeCommit,
        mainTree,
        releaseCandidateRun: releaseCandidateRun?.databaseId ?? null,
        productionRun: productionRun?.databaseId ?? null,
      },
      null,
      2,
    ),
  );
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) await main();
