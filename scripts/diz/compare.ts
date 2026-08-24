#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  compareDizFields,
  opaqueDizEvidence,
  parseDiz,
  type ThreeWayFieldComparison,
} from "../../src/domain/diz/index.ts";

function usage(): never {
  throw new Error("uso: npm run diz:compare -- BASE.diz CURRENT.diz OFFICIAL.diz");
}

function valueEvidence(value: string | undefined) {
  if (value === undefined) return { present: false, bytes: 0, sha256: null };
  return {
    present: true,
    bytes: Buffer.byteLength(value, "utf8"),
    sha256: createHash("sha256").update(value, "utf8").digest("hex"),
  };
}

function sanitize(items: ThreeWayFieldComparison[keyof ThreeWayFieldComparison]) {
  return items.map((item) => ({
    locator: `${item.quadro}/${item.module}/${item.field}`,
    base: valueEvidence(item.base),
    current: valueEvidence(item.current),
    official: valueEvidence(item.official),
  }));
}

const paths = process.argv.slice(2);
if (paths.length !== 3 || paths.some((file) => !file)) usage();

const [base, current, official] = paths.map((file) => parseDiz(readFileSync(file!)));
if (!base || !current || !official) usage();

const comparison = compareDizFields(base.fields, current.fields, official.fields);
const opaqueEvidence = {
  base: opaqueDizEvidence(base),
  current: opaqueDizEvidence(current),
  official: opaqueDizEvidence(official),
};
const acceptedCurrentChanges = comparison.unchanged.filter((item) => item.base !== item.current);
const unchangedFromBase = comparison.unchanged.length - acceptedCurrentChanges.length;
const blockers = [
  ...(comparison.conflicts.length > 0 ? ["qualified-field-conflict"] : []),
  ...(comparison.opaque.length > 0 ? ["unqualified-field-divergence"] : []),
  ...(new Set(Object.values(opaqueEvidence).map((item) => item.xmlSha256)).size > 1
    ? ["opaque-xml-divergence"]
    : []),
  ...(new Set(Object.values(opaqueEvidence).map((item) => item.attachmentsSha256)).size > 1
    ? ["attachment-divergence"]
    : []),
];
console.log(
  JSON.stringify(
    {
      schemaVersion: 3,
      inputs: {
        base: { sha256: base.sha256, bytes: base.bytes, fields: base.fields.length },
        current: { sha256: current.sha256, bytes: current.bytes, fields: current.fields.length },
        official: {
          sha256: official.sha256,
          bytes: official.bytes,
          fields: official.fields.length,
        },
      },
      result: {
        importFromOfficial: sanitize(comparison.importFromOfficial),
        keepCurrent: sanitize(comparison.keepCurrent),
        acceptedCurrentChanges: sanitize(acceptedCurrentChanges),
        unchangedFromBase,
        conflicts: sanitize(comparison.conflicts),
        opaque: sanitize(comparison.opaque),
        safety: {
          reconciliationAllowed: blockers.length === 0,
          blockers,
          opaqueEvidence,
        },
      },
    },
    null,
    2,
  ),
);
if (blockers.length > 0) process.exitCode = 2;
