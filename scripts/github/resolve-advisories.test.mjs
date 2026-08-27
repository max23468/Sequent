import assert from "node:assert/strict";
import test from "node:test";
import { recordedAdvisoryThreadIds } from "./resolve-advisories.mjs";

const headSha = "0123456789abcdef0123456789abcdef01234567";
const bot = { login: "chatgpt-codex-connector" };

test("risolve localmente soltanto advisory già registrati sull'HEAD", () => {
  const input = {
    headSha,
    issueComments: [
      {
        user: { login: "github-actions[bot]" },
        body: `<!-- sequent-codex-advisories:${headSha} -->\nAdvisory`,
      },
    ],
    reviewComments: [
      { id: 10, original_commit_id: headSha, body: "**P2** Advisory" },
      { id: 20, original_commit_id: headSha, body: "**P1** Blocker" },
    ],
    threads: [
      {
        id: "P2",
        isResolved: false,
        comments: { totalCount: 1, nodes: [{ databaseId: 10, author: bot }] },
      },
      {
        id: "P1",
        isResolved: false,
        comments: { totalCount: 1, nodes: [{ databaseId: 20, author: bot }] },
      },
    ],
  };
  assert.deepEqual(recordedAdvisoryThreadIds(input), ["P2"]);
  assert.deepEqual(recordedAdvisoryThreadIds({ ...input, issueComments: [] }), []);
});
