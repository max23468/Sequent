import assert from "node:assert/strict";
import test from "node:test";
import { validateManifest } from "./release-artifact.mjs";

const expected = {
  archiveName: "sequent.tar",
  archiveSha256: "a".repeat(64),
  commit: "b".repeat(40),
  imageId: `sha256:${"c".repeat(64)}`,
  tree: "d".repeat(40),
};
const manifest = {
  schema: "sequent-release-artifact/v1",
  commit: expected.commit,
  tree: expected.tree,
  platform: "linux/arm64",
  imageTag: "sequent-release:test",
  imageId: expected.imageId,
  archive: { name: expected.archiveName, sha256: expected.archiveSha256 },
};

test("accetta soltanto un artefatto legato a commit, tree, immagine e archivio", () => {
  assert.deepEqual(validateManifest(manifest, expected), []);
  assert.match(validateManifest({ ...manifest, tree: "0".repeat(40) }, expected)[0], /tree Git/);
  assert.match(
    validateManifest(
      { ...manifest, archive: { ...manifest.archive, sha256: "0".repeat(64) } },
      expected,
    )[0],
    /SHA-256/,
  );
});
