import assert from "node:assert/strict";
import test from "node:test";
import { validateManifest } from "./release-artifact.mjs";

const expected = {
  commit: "b".repeat(40),
  tree: "d".repeat(40),
  reference: `ghcr.io/max23468/sequent@sha256:${"c".repeat(64)}`,
};
const manifest = {
  schema: "sequent-release-image/v2",
  commit: expected.commit,
  tree: expected.tree,
  platform: "linux/arm64",
  version: "0.2.0",
  reference: expected.reference,
  digest: expected.reference.split("@")[1],
};

test("accetta soltanto un manifest legato a commit, tree e digest GHCR", () => {
  assert.deepEqual(validateManifest(manifest, expected), []);
  assert.match(validateManifest({ ...manifest, tree: "0".repeat(40) }, expected)[0], /tree Git/);
  assert.match(
    validateManifest({ ...manifest, digest: `sha256:${"0".repeat(64)}` }, expected)[0],
    /digest/,
  );
});
