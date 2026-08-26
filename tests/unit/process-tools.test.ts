import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../../src/lib/server/process-tools.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    try {
      readFileSync(path, "utf8");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("PID_FILE_MISSING");
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
  }
  throw new Error(`PROCESS_STILL_ALIVE:${pid}`);
}

describe("esecuzione strumenti documentali", () => {
  it.skipIf(process.platform === "win32")(
    "termina l'intero gruppo di processi prima di restituire il timeout",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "sequent-process-tree-"));
      directories.push(directory);
      const pidPath = join(directory, "descendant.pid");
      const parentScript = [
        'const { spawn } = require("node:child_process");',
        'const { writeFileSync } = require("node:fs");',
        'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true });',
        `writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
        "setInterval(() => {}, 1000);",
      ].join("\n");
      const command = runCommand(process.execPath, ["-e", parentScript], { timeoutMs: 5_000 });
      const timedOut = expect(command).rejects.toThrow("TOOL_TIMEOUT");
      await waitForFile(pidPath);
      const descendantPid = Number(readFileSync(pidPath, "utf8"));

      await timedOut;
      await waitForProcessExit(descendantPid);
    },
  );

  it.skipIf(process.platform === "win32")(
    "annulla il comando e i discendenti prima di restituire il controllo",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "sequent-process-cancel-"));
      directories.push(directory);
      const pidPath = join(directory, "cancelled-descendant.pid");
      const parentScript = [
        'const { spawn } = require("node:child_process");',
        'const { writeFileSync } = require("node:fs");',
        'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true });',
        `writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
        "setInterval(() => {}, 1000);",
      ].join("\n");
      const controller = new AbortController();
      const command = runCommand(process.execPath, ["-e", parentScript], {
        timeoutMs: 10_000,
        signal: controller.signal,
      });
      await waitForFile(pidPath);
      const descendantPid = Number(readFileSync(pidPath, "utf8"));
      controller.abort();

      await expect(command).rejects.toThrow("TOOL_CANCELLED");
      await waitForProcessExit(descendantPid);
    },
  );
});
