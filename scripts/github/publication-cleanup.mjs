import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

function git(cwd, args, options = {}) {
  const result = execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return typeof result === "string" ? result.trim() : "";
}

function parseWorktrees(value) {
  return value
    .split(/\n\n+/)
    .filter(Boolean)
    .map((record) => {
      const fields = Object.fromEntries(
        record.split("\n").map((line) => {
          const separator = line.indexOf(" ");
          return separator === -1
            ? [line, true]
            : [line.slice(0, separator), line.slice(separator + 1)];
        }),
      );
      return {
        path: fields.worktree,
        branch:
          typeof fields.branch === "string" ? fields.branch.replace(/^refs\/heads\//, "") : null,
        detached: Boolean(fields.detached),
      };
    });
}

function worktrees(cwd) {
  return parseWorktrees(git(cwd, ["worktree", "list", "--porcelain"]));
}

function isClean(cwd) {
  return git(cwd, ["status", "--porcelain"]) === "";
}

function refExists(cwd, ref) {
  try {
    git(cwd, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

export function publicationCleanupContext(cwd = process.cwd()) {
  const topLevel = git(cwd, ["rev-parse", "--show-toplevel"]);
  const gitDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  const commonDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return {
    topLevel,
    gitDir,
    commonDir,
    primaryWorktree: dirname(commonDir),
    branch: git(cwd, ["branch", "--show-current"]),
    linkedWorktree: gitDir !== commonDir,
  };
}

export function assertPublicationCleanupPossible(context) {
  if (!context.branch || context.branch === "main") {
    throw new Error("La chiusura richiede un branch breve corrente");
  }
  if (!isClean(context.topLevel)) {
    throw new Error("La chiusura non può rimuovere una working tree con modifiche locali");
  }

  const mainWorktree = worktrees(context.primaryWorktree).find((item) => item.branch === "main");
  if (mainWorktree && mainWorktree.path !== context.topLevel && !isClean(mainWorktree.path)) {
    throw new Error(`Il worktree di main non è pulito: ${mainWorktree.path}`);
  }
  if (!context.linkedWorktree && mainWorktree && mainWorktree.path !== context.topLevel) {
    throw new Error(
      `main è già aperto in ${mainWorktree.path}; il checkout principale non può chiudere il branch corrente`,
    );
  }
}

function alignMain(context) {
  const currentWorktrees = worktrees(context.primaryWorktree);
  const mainWorktree = currentWorktrees.find((item) => item.branch === "main");
  if (mainWorktree) {
    git(mainWorktree.path, ["merge", "--ff-only", "origin/main"], { stdio: "inherit" });
    return mainWorktree.path;
  }

  if (refExists(context.primaryWorktree, "refs/heads/main")) {
    try {
      git(context.primaryWorktree, ["merge-base", "--is-ancestor", "main", "origin/main"]);
    } catch {
      throw new Error("Il branch locale main diverge da origin/main");
    }
  }
  git(context.primaryWorktree, ["branch", "--force", "main", "origin/main"]);
  return null;
}

function inventory(context) {
  const localBranches = git(context.primaryWorktree, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  ])
    .split("\n")
    .filter((branch) => branch && branch !== "main");
  const remoteBranches = git(context.primaryWorktree, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/remotes/origin",
  ])
    .split("\n")
    .filter(
      (branch) =>
        branch && branch !== "origin" && branch !== "origin/HEAD" && branch !== "origin/main",
    );
  const stashes = git(context.primaryWorktree, ["stash", "list", "--format=%gd|%gs"])
    .split("\n")
    .filter(Boolean);
  return {
    localBranches,
    remoteBranches,
    stashes,
    worktrees: worktrees(context.primaryWorktree).map((item) => ({
      path: item.path,
      branch: item.branch,
      detached: item.detached,
    })),
  };
}

export function finalizePublicationCleanup(context) {
  assertPublicationCleanupPossible(context);
  git(context.topLevel, ["fetch", "origin", "--prune"], { stdio: "inherit" });

  const approvedTree = git(context.topLevel, ["rev-parse", "HEAD^{tree}"]);
  const mainTree = git(context.topLevel, ["rev-parse", "origin/main^{tree}"]);
  if (approvedTree !== mainTree) {
    throw new Error("Il branch temporaneo non coincide con l'albero pubblicato su origin/main");
  }
  if (refExists(context.topLevel, `refs/remotes/origin/${context.branch}`)) {
    throw new Error(`Il branch remoto temporaneo origin/${context.branch} esiste ancora`);
  }

  const mainWorktree = alignMain(context);
  if (context.linkedWorktree) {
    process.chdir(resolve(context.primaryWorktree, ".."));
    git(context.primaryWorktree, ["worktree", "remove", context.topLevel]);
  } else {
    git(context.topLevel, ["switch", "main"], { stdio: "inherit" });
    git(context.topLevel, ["merge", "--ff-only", "origin/main"], { stdio: "inherit" });
  }
  git(context.primaryWorktree, ["branch", "--delete", "--force", context.branch]);

  const localMain = git(context.primaryWorktree, ["rev-parse", "main"]);
  const remoteMain = git(context.primaryWorktree, ["rev-parse", "origin/main"]);
  if (localMain !== remoteMain) throw new Error("main locale non è allineato a origin/main");

  return {
    branchRimosso: context.branch,
    worktreeRimosso: context.linkedWorktree ? context.topLevel : null,
    mainAllineato: remoteMain,
    mainWorktree,
    residuiIntenzionalmentePreservati: inventory(context),
  };
}
