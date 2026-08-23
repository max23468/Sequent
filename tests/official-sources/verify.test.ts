import assert from "node:assert/strict";
import { test } from "node:test";

import { assertSafeRelativePath, compositeDigest } from "../../scripts/official-sources/verify.ts";

test("accetta soltanto path relativi confinati", () => {
  assert.doesNotThrow(() => assertSafeRelativePath("SUC/xsd/schema.xsd"));
  assert.throws(() => assertSafeRelativePath("../schema.xsd"), /path non sicuro/);
  assert.throws(() => assertSafeRelativePath("/schema.xsd"), /path non sicuro/);
  assert.throws(() => assertSafeRelativePath("SUC\\..\\schema.xsd"), /path non sicuro/);
});

test("il digest composito include ordine e terminatori", () => {
  assert.equal(
    compositeDigest(["SRC-01:abc\n", "SRC-02:def\n"]),
    "e9a72f4949a66c52d7d6efbbb8579ce505d468dfcb7f86337797ea8d7f67f0a0",
  );
});
