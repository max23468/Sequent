#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const forbiddenPrefixes = ["private/", "data/", "runtime/", "releases/", "snapshots/", "tmp/"];
const forbiddenSuffixes = [".diz", ".suc", ".telematico", ".key", ".pem", ".p12", ".pfx"];
const officialBinarySuffixes = [".pdf", ".zip"];

const violations = tracked.filter((file) => {
  const lower = file.toLowerCase();
  return (
    forbiddenPrefixes.some((prefix) => lower.startsWith(prefix)) ||
    forbiddenSuffixes.some((suffix) => lower.endsWith(suffix)) ||
    officialBinarySuffixes.some((suffix) => lower.endsWith(suffix))
  );
});

if (violations.length > 0) {
  console.error("File non pubblicabili tracciati:\n" + violations.join("\n"));
  process.exit(1);
}

console.log(`Confine pubblico verificato: ${tracked.length} file tracciati`);
