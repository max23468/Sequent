import assert from "node:assert/strict";
import test from "node:test";
import { RECEIPT_MAX_AGE_MS, RECEIPT_SCHEMA, validateReceipt } from "./publication-receipt.mjs";

const identity = {
  schema: RECEIPT_SCHEMA,
  head: "a".repeat(40),
  tree: "b".repeat(40),
  commands: [["npm", "run", "verify:public"]],
};

test("riusa una ricevuta solo per identità esatta e non scaduta", () => {
  const now = Date.now();
  const receipt = { ...identity, createdAt: new Date(now - 1_000).toISOString() };
  assert.equal(validateReceipt(receipt, identity, now), true);
  assert.equal(validateReceipt({ ...receipt, tree: "c".repeat(40) }, identity, now), false);
  assert.equal(
    validateReceipt(
      { ...receipt, createdAt: new Date(now - RECEIPT_MAX_AGE_MS - 1).toISOString() },
      identity,
      now,
    ),
    false,
  );
  assert.equal(validateReceipt({ ...receipt, createdAt: "non-data" }, identity, now), false);
  assert.equal(
    validateReceipt({ ...receipt, createdAt: new Date(now + 1_000).toISOString() }, identity, now),
    false,
  );
});
