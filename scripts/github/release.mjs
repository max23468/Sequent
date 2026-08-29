#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const output = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

export function releaseNotes(changelog, version) {
  const escaped = version.replaceAll(".", "\\.");
  const match = new RegExp(
    `^## ${escaped}[^\\n]*\\n(?<body>[\\s\\S]*?)(?=^## \\d+\\.\\d+\\.\\d+|(?![\\s\\S]))`,
    "m",
  ).exec(changelog.replace(/\n*$/, "\n"));
  if (!match?.groups?.body.trim()) throw new Error(`Voce CHANGELOG ${version} assente`);
  return `## Novità\n\n${match.groups.body.trim()}\n`;
}

export function releaseCommitMatches({ checkOnly, commit, head, main }) {
  return checkOnly ? commit === head || commit === main : commit === main;
}

function main() {
  const commit = argument("--commit");
  const checkOnly = process.argv.includes("--check");
  if (!/^[0-9a-f]{40}$/.test(commit ?? "")) throw new Error("Usa --commit con uno SHA completo");
  const head = output("git", ["rev-parse", "HEAD"]);
  const mainCommit = output("git", ["rev-parse", "origin/main"]);
  if (!releaseCommitMatches({ checkOnly, commit, head, main: mainCommit }))
    throw new Error(checkOnly ? "Verifica release non exact-HEAD/main" : "Release non exact-main");
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Versione release non SemVer numerica");
  const tag = `v${version}`;
  const notes = releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version);
  const existing = spawnSync("gh", ["api", `repos/{owner}/{repo}/releases/tags/${tag}`], {
    encoding: "utf8",
  });
  if (existing.status === 0) {
    const target = output("gh", ["api", `repos/{owner}/{repo}/commits/${tag}`, "--jq", ".sha"]);
    if (target !== commit) throw new Error(`La release ${tag} punta a ${target}`);
    if (checkOnly) return;
    console.log(`Release ${tag} già presente e coerente`);
  } else {
    if (!/HTTP 404/.test(existing.stderr ?? "")) {
      throw new Error(`Impossibile verificare la release ${tag}: ${existing.stderr.trim()}`);
    }
    if (checkOnly) return;
    const created = spawnSync(
      "gh",
      [
        "release",
        "create",
        tag,
        "--target",
        commit,
        "--title",
        `Sequent ${version}`,
        "--notes-file",
        "-",
      ],
      { encoding: "utf8", input: notes, stdio: ["pipe", "inherit", "inherit"] },
    );
    if (created.status !== 0) throw new Error(`Creazione release ${tag} non riuscita`);
    const target = output("gh", ["api", `repos/{owner}/{repo}/commits/${tag}`, "--jq", ".sha"]);
    if (target !== commit) throw new Error(`Readback release ${tag} divergente`);
  }
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main();
