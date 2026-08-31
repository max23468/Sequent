import { spawnSync } from "node:child_process";
import {
  assertChatGPTLoginStatus,
  buildCodexLoginEnvironment,
  codexCliPath,
  prepareDedicatedCodexHome,
} from "../../src/lib/server/codex-login.ts";

const statusOnly = process.argv.includes("--status-only");
const codexHome = await prepareDedicatedCodexHome();
const environment = buildCodexLoginEnvironment(codexHome);
const cliPath = codexCliPath();

if (!statusOnly) {
  const login = spawnSync(process.execPath, [cliPath, "login", "--device-auth"], {
    env: environment,
    stdio: "inherit",
  });
  if (login.error) throw login.error;
  if (login.status !== 0) throw new Error("CODEX_DEVICE_LOGIN_FAILED");
}

const status = spawnSync(process.execPath, [cliPath, "login", "status"], {
  env: environment,
  encoding: "utf8",
  maxBuffer: 32_768,
});
if (status.error) throw status.error;
if (status.status !== 0) throw new Error("CODEX_LOGIN_STATUS_FAILED");
assertChatGPTLoginStatus(`${status.stdout}\n${status.stderr}`);
console.log("Sessione ChatGPT disponibile nella home Codex dedicata.");
