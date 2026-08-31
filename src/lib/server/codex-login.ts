import { chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { getCodexHome } from "./config.ts";
import { requireDedicatedCodexHome } from "./codex-home.ts";

const CODEX_ENVIRONMENT_NAMES = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NODE_EXTRA_CA_CERTS",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;

export async function prepareDedicatedCodexHome(): Promise<string> {
  const configuredHome = getCodexHome();
  if (!configuredHome) throw new Error("CODEX_HOME_REQUIRED");

  const configuredPath = resolve(configuredHome);
  await mkdir(configuredPath, { recursive: true, mode: 0o700 });
  await chmod(configuredPath, 0o700);
  return requireDedicatedCodexHome();
}

export function buildCodexLoginEnvironment(codexHome: string): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    CODEX_ENVIRONMENT_NAMES.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  );
  environment.CODEX_HOME = codexHome;
  return environment;
}

export function codexCliPath(): string {
  return resolve("node_modules", "@openai", "codex", "bin", "codex.js");
}

export function assertChatGPTLoginStatus(output: string): void {
  if (/api key/i.test(output)) throw new Error("CODEX_API_KEY_DISALLOWED");
  if (!/logged in (?:using|with) chatgpt/i.test(output))
    throw new Error("CODEX_CHATGPT_LOGIN_REQUIRED");
}
