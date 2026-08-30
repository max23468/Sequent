import { lstat, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { getCodexHome } from "./config.ts";

export async function requireDedicatedCodexHome(): Promise<string> {
  const configuredHome = getCodexHome();
  if (!configuredHome) throw new Error("CODEX_HOME_REQUIRED");

  const configuredPath = resolve(configuredHome);
  const generalHome = resolve(homedir(), ".codex");
  if (configuredPath === resolve(homedir()) || configuredPath === generalHome)
    throw new Error("CODEX_HOME_NOT_DEDICATED");

  const information = await lstat(configuredPath);
  if (!information.isDirectory() || information.isSymbolicLink())
    throw new Error("CODEX_HOME_NOT_DEDICATED");
  if (process.platform !== "win32" && (information.mode & 0o077) !== 0)
    throw new Error("CODEX_HOME_NOT_PRIVATE");

  const resolvedHome = await realpath(configuredPath);
  const forbiddenEntries = new Set(["config.toml", "requirements.toml", "plugins"]);
  const entries = await readdir(resolvedHome);
  if (entries.some((entry) => forbiddenEntries.has(entry)))
    throw new Error("CODEX_HOME_NOT_DEDICATED");
  return resolvedHome;
}
