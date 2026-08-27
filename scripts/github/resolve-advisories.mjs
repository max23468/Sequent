#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolvableAdvisoryThreadIds } from "../codex-review-gate.mjs";

const ADVISORY_MARKER = "<!-- sequent-codex-advisories:";

function output(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function json(command, args) {
  return JSON.parse(output(command, args));
}

function paged(path) {
  return json("gh", ["api", "--paginate", "--slurp", path]).flat();
}

export function recordedAdvisoryThreadIds({ headSha, issueComments, reviewComments, threads }) {
  const recorded = issueComments.some(
    (comment) =>
      comment.user?.login === "github-actions[bot]" &&
      comment.body?.startsWith(`${ADVISORY_MARKER}${headSha} -->`),
  );
  if (!recorded) return [];
  const exactInline = reviewComments.filter((comment) => comment.original_commit_id === headSha);
  return resolvableAdvisoryThreadIds(threads, exactInline);
}

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function reviewThreads(repository, number) {
  const [owner, name] = repository.split("/");
  const data = json("gh", [
    "api",
    "graphql",
    "-f",
    `query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved comments(first:100){totalCount nodes{databaseId author{login}}}} pageInfo{hasNextPage}}}}}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-F",
    `number=${number}`,
  ]).data.repository.pullRequest.reviewThreads;
  if (data.pageInfo.hasNextPage)
    throw new Error("Più di 100 thread: risoluzione advisory bloccata");
  return data.nodes;
}

function resolveThread(threadId) {
  const result = json("gh", [
    "api",
    "graphql",
    "-f",
    "query=mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}",
    "-f",
    `threadId=${threadId}`,
  ]);
  if (!result.data.resolveReviewThread.thread.isResolved) {
    throw new Error(`Thread advisory ${threadId} non risolto`);
  }
}

function main(args = process.argv.slice(2)) {
  const repository = argument(args, "--repository");
  const number = argument(args, "--pull-request");
  const headSha = argument(args, "--head");
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository ?? "")) throw new Error("Repository non valido");
  if (!/^\d+$/.test(number ?? "")) throw new Error("Numero PR non valido");
  if (!/^[0-9a-f]{40}$/.test(headSha ?? "")) throw new Error("HEAD non valido");

  const pullRequest = json("gh", ["api", `repos/${repository}/pulls/${number}`]);
  if (pullRequest.head.sha !== headSha) throw new Error("La PR non punta all'HEAD verificato");

  const threadIds = recordedAdvisoryThreadIds({
    headSha,
    issueComments: paged(`repos/${repository}/issues/${number}/comments?per_page=100`),
    reviewComments: paged(`repos/${repository}/pulls/${number}/comments?per_page=100`),
    threads: reviewThreads(repository, number),
  });
  for (const threadId of threadIds) resolveThread(threadId);
  console.log(`Thread advisory risolti dal client locale: ${threadIds.length}`);
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main();
