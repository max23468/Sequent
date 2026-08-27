import assert from "node:assert/strict";
import test from "node:test";
import { validateReleaseReview } from "./release-review.mjs";

const candidateCommit = "a".repeat(40);
const candidateTree = "b".repeat(40);
const reviewedHead = "c".repeat(40);
const evidence = {
  candidateCommit,
  candidateTree,
  reviewedHead,
  reviewedTree: candidateTree,
  pulls: [
    {
      number: 17,
      merged_at: "2026-08-27T08:00:00Z",
      merge_commit_sha: candidateCommit,
      head: { sha: reviewedHead },
    },
  ],
  statuses: [
    {
      context: "codex-review",
      state: "success",
      updated_at: "2026-08-27T08:00:00Z",
    },
  ],
};

test("lega la candidata squash all'albero dell'HEAD approvato", () => {
  assert.deepEqual(validateReleaseReview(evidence), {
    pullRequest: 17,
    reviewedHead,
    candidateCommit,
    candidateTree,
  });
});

test("blocca albero divergente o gate exact-HEAD rosso", () => {
  assert.throws(
    () => validateReleaseReview({ ...evidence, reviewedTree: "d".repeat(40) }),
    /albero della candidata diverge/,
  );
  assert.throws(
    () =>
      validateReleaseReview({
        ...evidence,
        statuses: [{ context: "codex-review", state: "failure" }],
      }),
    /non verde/,
  );
});
