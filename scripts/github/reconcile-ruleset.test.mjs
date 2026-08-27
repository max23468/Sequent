import assert from "node:assert/strict";
import test from "node:test";
import { reconciledRuleset, REQUIRED_CHECKS } from "./reconcile-ruleset.mjs";

test("sostituisce soltanto i required checks e preserva le altre protezioni", () => {
  const current = {
    name: "main protection",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "pull_request", parameters: { required_review_thread_resolution: true } },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: "public-gates" }],
        },
      },
    ],
  };
  const desired = reconciledRuleset(current);
  assert.deepEqual(
    desired.rules.find((rule) => rule.type === "required_status_checks").parameters
      .required_status_checks,
    REQUIRED_CHECKS.map((context) => ({ context })),
  );
  assert.equal(
    desired.rules.find((rule) => rule.type === "pull_request").parameters
      .required_review_thread_resolution,
    true,
  );
  assert.equal(current.rules[2].parameters.required_status_checks[0].context, "public-gates");
});

test("fallisce chiuso se manca la regola da riconciliare", () => {
  assert.throws(
    () =>
      reconciledRuleset({
        name: "main protection",
        target: "branch",
        enforcement: "active",
        conditions: {},
        rules: [],
      }),
    /required_status_checks/,
  );
});
