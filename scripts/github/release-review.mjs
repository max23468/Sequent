#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function output(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function json(command, args) {
  return JSON.parse(output(command, args));
}

export function validateReleaseReview({
  candidateCommit,
  candidateTree,
  pulls,
  reviewedHead,
  reviewedTree,
}) {
  const associated = pulls.filter(
    (pull) => pull.merged_at && pull.merge_commit_sha === candidateCommit,
  );
  if (associated.length !== 1) {
    throw new Error("La candidata non identifica un'unica pull request merged");
  }
  const pull = associated[0];
  if (pull.head?.sha !== reviewedHead)
    throw new Error("HEAD approvato divergente dalla pull request");
  if (reviewedTree !== candidateTree) {
    throw new Error("L'albero della candidata diverge dall'HEAD approvato");
  }

  return { pullRequest: pull.number, reviewedHead, candidateCommit, candidateTree };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const candidateCommit = argument("--commit");
  const repository = process.env.GITHUB_REPOSITORY;
  if (!candidateCommit || !/^[0-9a-f]{40}$/.test(candidateCommit)) {
    throw new Error("Usa --commit con uno SHA completo");
  }
  if (!repository) throw new Error("GITHUB_REPOSITORY assente");

  const candidateTree = output("git", ["rev-parse", `${candidateCommit}^{tree}`]);
  const pulls = json("gh", [
    "api",
    `repos/${repository}/commits/${candidateCommit}/pulls?per_page=100`,
  ]);
  const associated = pulls.filter(
    (pull) => pull.merged_at && pull.merge_commit_sha === candidateCommit,
  );
  if (associated.length !== 1) {
    throw new Error("La candidata non identifica un'unica pull request merged");
  }
  const pull = associated[0];
  const reviewedHead = pull.head.sha;

  execFileSync("git", ["fetch", "--quiet", "--no-tags", "origin", `pull/${pull.number}/head`]);
  if (output("git", ["rev-parse", "FETCH_HEAD"]) !== reviewedHead) {
    throw new Error("Il ref della pull request diverge dall'HEAD approvato");
  }
  const reviewedTree = output("git", ["rev-parse", "FETCH_HEAD^{tree}"]);
  process.stdout.write(
    `${JSON.stringify(
      validateReleaseReview({
        candidateCommit,
        candidateTree,
        pulls,
        reviewedHead,
        reviewedTree,
      }),
      null,
      2,
    )}\n`,
  );
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main();
