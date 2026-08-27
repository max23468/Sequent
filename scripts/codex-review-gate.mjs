import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const CODEX_BOT = "chatgpt-codex-connector[bot]";
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
export const CODEX_REVIEW_POLLING = {
  fastAttempts: 20,
  fastIntervalMs: 30_000,
  slowAttempts: 96,
  slowIntervalMs: 180_000,
};
const ADVISORY_MARKER = "<!-- sequent-codex-advisories:";

export const isCodexBotLogin = (login) =>
  login === CODEX_BOT || login === CODEX_BOT.replace(/\[bot\]$/, "");

export const isAdvisoryResolutionPermissionError = (error) =>
  /Resource not accessible by integration/i.test(error?.message ?? "");

const timestamp = (value) => new Date(value ?? 0).getTime();
const signalTimestamp = (signal) => timestamp(signal.submitted_at ?? signal.created_at);
const matchesHead = (candidate, headSha) => Boolean(candidate && headSha.startsWith(candidate));

export const reviewedCommit = (body = "") =>
  body.match(/\*\*Reviewed commit:\*\*\s*`([0-9a-f]{10,40})`/i)?.[1];

export const findingPriority = (body = "") =>
  body.match(/^(?:\*\*|<sub>)*(?:!?\[)?(P[0-3])(?: Badge)?(?:\]\([^)]*\)|\]\s*|\*\*)/m)?.[1];

export const isHeadReset = (eventName, action) =>
  eventName === "pull_request_target" && action === "synchronize";

export const isAutomaticFirstReview = (eventName, action) =>
  eventName === "pull_request_target" && ["opened", "ready_for_review"].includes(action);

export const latestCodexInvocation = (comments, headAvailableAt) =>
  comments
    .filter(
      (comment) =>
        !isCodexBotLogin(comment.user?.login) &&
        TRUSTED_ASSOCIATIONS.has(comment.author_association) &&
        /^\s*@codex\s+review\s*$/i.test(comment.body) &&
        timestamp(comment.created_at) >= timestamp(headAvailableAt),
    )
    .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at))[0];

export function classifyCodexReview({
  automatic = false,
  comments = [],
  headSha,
  invocationReactions = [],
  now = Date.now(),
  prReactions = [],
  requestedAt,
  reviewComments = [],
  reviews = [],
}) {
  const afterRequest = (signal) => signalTimestamp(signal) >= timestamp(requestedAt);
  const exactInline = reviewComments.filter(
    (comment) => isCodexBotLogin(comment.user?.login) && comment.original_commit_id === headSha,
  );
  const exactTopLevel = comments.filter(
    (comment) =>
      isCodexBotLogin(comment.user?.login) && matchesHead(reviewedCommit(comment.body), headSha),
  );
  const exactReviews = reviews.filter(
    (review) =>
      isCodexBotLogin(review.user?.login) &&
      (review.commit_id === headSha || matchesHead(reviewedCommit(review.body), headSha)) &&
      afterRequest(review),
  );
  const exactSignals = [...exactInline, ...exactTopLevel, ...exactReviews];

  const blockingFinding = exactSignals
    .filter((signal) => ["P0", "P1"].includes(findingPriority(signal.body)))
    .sort((left, right) => signalTimestamp(right) - signalTimestamp(left))[0];
  if (blockingFinding) {
    return {
      state: "failure",
      description: `Codex ha trovato un finding ${findingPriority(blockingFinding.body)}`,
    };
  }

  const completionTimes = exactReviews.map(signalTimestamp);
  for (const comment of exactTopLevel) {
    if (
      afterRequest(comment) &&
      (/^Codex Review: Didn't find any major issues\./m.test(comment.body) ||
        ["P2", "P3"].includes(findingPriority(comment.body)))
    ) {
      completionTimes.push(signalTimestamp(comment));
    }
  }

  const reactions = automatic ? prReactions : invocationReactions;
  for (const reaction of reactions) {
    if (
      isCodexBotLogin(reaction.user?.login) &&
      reaction.content === "+1" &&
      timestamp(reaction.created_at) >= timestamp(requestedAt)
    ) {
      completionTimes.push(timestamp(reaction.created_at));
    }
  }

  const operationalErrorAt = comments
    .filter(
      (comment) =>
        isCodexBotLogin(comment.user?.login) &&
        afterRequest(comment) &&
        /reached your Codex usage limits|could not complete|unable to review|something went wrong|unknown error/i.test(
          comment.body,
        ),
    )
    .reduce((latest, comment) => Math.max(latest, signalTimestamp(comment)), 0);
  const completionAt = Math.max(...completionTimes, 0);
  if (operationalErrorAt > completionAt) {
    return { state: "error", description: "La review Codex non è stata completata" };
  }

  const settledAt = Math.max(completionAt, ...exactSignals.map(signalTimestamp));
  if (completionAt && now - settledAt >= 30_000) {
    const advisory = exactSignals.some((signal) =>
      ["P2", "P3"].includes(findingPriority(signal.body)),
    );
    return {
      state: "success",
      description: advisory
        ? "Codex: solo finding P2/P3 advisory"
        : "Codex ha approvato l'ultimo commit",
    };
  }

  return { state: "pending", description: "In attesa della review Codex" };
}

export function advisoryRecord(headSha, findings) {
  const rows = findings
    .filter((finding) => ["P2", "P3"].includes(findingPriority(finding.body)))
    .map((finding) => {
      const priority = findingPriority(finding.body);
      const location = finding.path
        ? `\`${finding.path}${finding.line ? `:${finding.line}` : ""}\``
        : "review generale";
      const summary = finding.body
        .replace(/^(?:\*\*|<sub>)*(?:!?\[)?P[23](?: Badge)?(?:\]\([^)]*\)|\]\s*|\*\*)/m, "")
        .trim()
        .split("\n")[0]
        .replaceAll("|", "\\|")
        .slice(0, 240);
      const reference = finding.html_url ? `[apri](${finding.html_url})` : "—";
      return `| ${priority} | ${location} | ${summary || "Finding advisory"} | ${reference} |`;
    });
  if (rows.length === 0) return undefined;
  return `${ADVISORY_MARKER}${headSha} -->
### Advisory Codex registrati per \`${headSha.slice(0, 12)}\`

Questi finding non bloccano il merge. I thread automatici senza risposte umane vengono risolti dopo questa registrazione; il contenuto resta tracciato qui e nella review originale.

| Priorità | Posizione | Sintesi | Review |
|---|---|---|---|
${rows.join("\n")}`;
}

export function resolvableAdvisoryThreadIds(threads, exactReviewComments) {
  const advisoryIds = new Set(
    exactReviewComments
      .filter((comment) => ["P2", "P3"].includes(findingPriority(comment.body)))
      .map((comment) => comment.id),
  );
  const blockingIds = new Set(
    exactReviewComments
      .filter((comment) => ["P0", "P1"].includes(findingPriority(comment.body)))
      .map((comment) => comment.id),
  );

  return threads
    .filter((thread) => {
      if (thread.isResolved) return false;
      const comments = thread.comments?.nodes ?? [];
      if (thread.comments?.totalCount > comments.length) return false;
      if (comments.some((comment) => !isCodexBotLogin(comment.author?.login))) return false;
      if (comments.some((comment) => blockingIds.has(comment.databaseId))) return false;
      const advisoryIndex = comments.findIndex((comment) => advisoryIds.has(comment.databaseId));
      if (advisoryIndex < 0) return false;
      return true;
    })
    .map((thread) => thread.id);
}

export function pollingIntervals() {
  return [
    ...Array(CODEX_REVIEW_POLLING.fastAttempts).fill(CODEX_REVIEW_POLLING.fastIntervalMs),
    ...Array(CODEX_REVIEW_POLLING.slowAttempts).fill(CODEX_REVIEW_POLLING.slowIntervalMs),
  ];
}

export function pullRequestNumber(event, input) {
  const number = String(event.pull_request?.number ?? event.issue?.number ?? input);
  if (!/^\d+$/.test(number)) throw new Error("Numero PR non valido");
  return number;
}

async function request(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path}: ${response.status}`);
  return response.json();
}

async function graphql(query, variables) {
  const response = await request("/graphql", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  if (response.errors?.length)
    throw new Error(response.errors.map((error) => error.message).join("; "));
  return response.data;
}

async function all(path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch = await request(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

async function setStatus(repository, sha, state, description) {
  await request(`/repos/${repository}/statuses/${sha}`, {
    method: "POST",
    body: JSON.stringify({
      state,
      context: "codex-review",
      description,
      target_url: `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    }),
  });
}

async function pullRequestThreads(repository, number) {
  const [owner, name] = repository.split("/");
  const threads = [];
  let cursor = null;
  do {
    const data = await graphql(
      `
        query ($owner: String!, $name: String!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              reviewThreads(first: 100, after: $cursor) {
                nodes {
                  id
                  isResolved
                  comments(first: 100) {
                    totalCount
                    nodes {
                      databaseId
                      author {
                        login
                      }
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      `,
      { owner, name, number: Number(number), cursor },
    );
    const connection = data.repository.pullRequest.reviewThreads;
    threads.push(...connection.nodes);
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  return threads;
}

async function recordAndResolveAdvisories({
  comments,
  headSha,
  number,
  repository,
  reviewComments,
  reviews,
}) {
  const exactInline = reviewComments.filter(
    (comment) => isCodexBotLogin(comment.user?.login) && comment.original_commit_id === headSha,
  );
  const exactTopLevel = comments.filter(
    (comment) =>
      isCodexBotLogin(comment.user?.login) && matchesHead(reviewedCommit(comment.body), headSha),
  );
  const exactReviews = reviews.filter(
    (review) =>
      isCodexBotLogin(review.user?.login) &&
      (review.commit_id === headSha || matchesHead(reviewedCommit(review.body), headSha)),
  );
  const exactFindings = [...exactInline, ...exactTopLevel, ...exactReviews];
  const body = advisoryRecord(headSha, exactFindings);
  if (!body) return;

  const marker = `${ADVISORY_MARKER}${headSha} -->`;
  const existing = comments.find(
    (comment) => comment.user?.login === "github-actions[bot]" && comment.body?.startsWith(marker),
  );
  if (!existing) {
    await request(`/repos/${repository}/issues/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  } else if (existing.body !== body) {
    await request(`/repos/${repository}/issues/comments/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
  }

  const threads = await pullRequestThreads(repository, number);
  for (const threadId of resolvableAdvisoryThreadIds(threads, exactInline)) {
    try {
      await graphql(
        `
          mutation ($threadId: ID!) {
            resolveReviewThread(input: { threadId: $threadId }) {
              thread {
                id
                isResolved
              }
            }
          }
        `,
        { threadId },
      );
    } catch (error) {
      if (!isAdvisoryResolutionPermissionError(error)) throw error;
      console.warn(
        `Risoluzione automatica non consentita per ${threadId}; completa l'orchestratore locale.`,
      );
    }
  }
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  const number = pullRequestNumber(event, process.env.PULL_REQUEST_NUMBER);
  const pullRequest = await request(`/repos/${repository}/pulls/${number}`);
  const headSha = pullRequest.head.sha;
  const headCommit = await request(`/repos/${repository}/commits/${headSha}`);
  const automatic = isAutomaticFirstReview(process.env.GITHUB_EVENT_NAME, event.action);
  const headAvailableAt =
    event.action === "synchronize"
      ? event.pull_request.updated_at
      : headCommit.commit.committer.date;

  await setStatus(repository, headSha, "pending", "In attesa della review Codex");
  if (isHeadReset(process.env.GITHUB_EVENT_NAME, event.action)) return;
  if (pullRequest.draft) return;

  for (const intervalMs of pollingIntervals()) {
    const [comments, prReactions, reviews, reviewComments] = await Promise.all([
      all(`/repos/${repository}/issues/${number}/comments`),
      all(`/repos/${repository}/issues/${number}/reactions`),
      all(`/repos/${repository}/pulls/${number}/reviews`),
      all(`/repos/${repository}/pulls/${number}/comments`),
    ]);
    const latestInvocation = latestCodexInvocation(comments, headAvailableAt);
    const invocation =
      process.env.GITHUB_EVENT_NAME !== "issue_comment" ||
      latestInvocation?.id === event.comment?.id
        ? latestInvocation
        : undefined;
    const invocationReactions = invocation
      ? await all(`/repos/${repository}/issues/comments/${invocation.id}/reactions`)
      : [];
    const requestedAt = automatic
      ? (event.pull_request?.updated_at ?? pullRequest.created_at)
      : (invocation?.created_at ?? headAvailableAt);
    const result = classifyCodexReview({
      automatic,
      comments,
      headSha,
      invocationReactions,
      prReactions,
      requestedAt,
      reviewComments,
      reviews,
    });
    if (result.state !== "pending") {
      if (result.state === "success") {
        try {
          await recordAndResolveAdvisories({
            comments,
            headSha,
            number,
            repository,
            reviewComments,
            reviews,
          });
        } catch (error) {
          await setStatus(repository, headSha, "error", "Advisory Codex non registrati");
          throw error;
        }
      }
      await setStatus(repository, headSha, result.state, result.description);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  await setStatus(repository, headSha, "error", "Review Codex non conclusa entro cinque ore");
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (process.env.GITHUB_ACTIONS === "true" && isDirectExecution) {
  await main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
