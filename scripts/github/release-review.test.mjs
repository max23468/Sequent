import assert from "node:assert/strict";
import test from "node:test";
import { REUSED_PR_CHECKS, validateReleaseReview } from "./release-review.mjs";

const candidateCommit = "a".repeat(40);
const candidateTree = "b".repeat(40);
const reviewedHead = "c".repeat(40);
const evidence = {
  candidateCommit,
  candidateTree,
  reviewedHead,
  reviewedTree: candidateTree,
  statusCheckRollup: REUSED_PR_CHECKS.map((name) => ({ name, conclusion: "SUCCESS" })),
  pulls: [
    {
      number: 17,
      merged_at: "2026-08-27T08:00:00Z",
      merge_commit_sha: candidateCommit,
      head: { sha: reviewedHead },
    },
  ],
};

test("lega la candidata squash all'albero dell'HEAD approvato", () => {
  assert.deepEqual(validateReleaseReview(evidence), {
    schema: "sequent-release-review/v1",
    pullRequest: 17,
    reviewedHead,
    candidateCommit,
    candidateTree,
    reusedChecks: REUSED_PR_CHECKS,
  });
});

test("blocca il riuso se un gate PR non è verde", () => {
  assert.throws(
    () => validateReleaseReview({ ...evidence, statusCheckRollup: [] }),
    /Evidenza PR assente/,
  );
});

test("blocca un albero divergente", () => {
  assert.throws(
    () => validateReleaseReview({ ...evidence, reviewedTree: "d".repeat(40) }),
    /albero della candidata diverge/,
  );
});
