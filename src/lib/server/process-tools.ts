import { execFileSync, spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

interface CommandResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  arguments_: string[],
  options?: { timeoutMs?: number; maxOutputBytes?: number; cwd?: string; signal?: AbortSignal },
) => Promise<CommandResult>;

function processTable(): Array<{ pid: number; parentPid: number }> {
  if (process.platform === "linux") {
    const rows: Array<{ pid: number; parentPid: number }> = [];
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      try {
        const stat = readFileSync(`/proc/${entry.name}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        rows.push({ pid: Number(entry.name), parentPid: Number(fields[1]) });
      } catch {
        // Il processo può terminare durante l'inventario.
      }
    }
    return rows;
  }
  const output = execFileSync("/bin/ps", ["-axo", "pid=,ppid="], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  return output
    .trim()
    .split("\n")
    .flatMap((line) => {
      const [pid, parentPid] = line.trim().split(/\s+/).map(Number);
      return Number.isInteger(pid) && Number.isInteger(parentPid)
        ? [{ pid: pid as number, parentPid: parentPid as number }]
        : [];
    });
}

function descendantsOf(rootPid: number): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const row of processTable()) {
    const children = childrenByParent.get(row.parentPid) ?? [];
    children.push(row.pid);
    childrenByParent.set(row.parentPid, children);
  }
  const descendants: number[] = [];
  const pending = [...(childrenByParent.get(rootPid) ?? [])];
  while (pending.length > 0) {
    const pid = pending.pop();
    if (pid === undefined) continue;
    descendants.push(pid);
    pending.push(...(childrenByParent.get(pid) ?? []));
  }
  return descendants;
}

function safeKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

function killProcessTree(rootPid: number, useProcessGroup: boolean): void {
  if (!useProcessGroup) {
    safeKill(rootPid, "SIGKILL");
    return;
  }
  safeKill(-rootPid, "SIGSTOP");
  const stopped = new Set<number>();
  for (;;) {
    const descendants = descendantsOf(rootPid);
    const unstopped = descendants.filter((pid) => !stopped.has(pid));
    if (unstopped.length === 0) break;
    for (const pid of unstopped) {
      safeKill(pid, "SIGSTOP");
      stopped.add(pid);
    }
  }
  for (const pid of [...stopped].reverse()) safeKill(pid, "SIGKILL");
  safeKill(-rootPid, "SIGKILL");
}

export const runCommand: CommandRunner = async (command, arguments_, options = {}) => {
  if (options.signal?.aborted) throw new Error("TOOL_CANCELLED");
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024;
  return await new Promise<CommandResult>((resolve, reject) => {
    const useProcessGroup = process.platform !== "win32";
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: useProcessGroup,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let pendingError: Error | null = null;
    const terminate = () => {
      if (!child.pid) return;
      killProcessTree(child.pid, useProcessGroup);
    };
    const stop = (error: Error) => {
      if (settled || pendingError) return;
      pendingError = error;
      terminate();
    };
    const cancel = () => stop(new Error("TOOL_CANCELLED"));
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => stop(new Error("TOOL_TIMEOUT")), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) stop(new Error("TOOL_OUTPUT_LIMIT"));
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) stop(new Error("TOOL_OUTPUT_LIMIT"));
      else stderr.push(chunk);
    });
    child.on("error", (error) => stop(new Error(`TOOL_UNAVAILABLE:${command}:${error.message}`)));
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      if (settled) return;
      settled = true;
      if (pendingError) {
        reject(pendingError);
        return;
      }
      const output = Buffer.concat(stdout).toString("utf8");
      const errors = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        reject(new Error(`TOOL_FAILED:${command}:${code}:${errors.slice(0, 240)}`));
        return;
      }
      resolve({ stdout: output, stderr: errors });
    });
  });
};

export async function readToolVersion(
  command: string,
  arguments_: string[],
  runner: CommandRunner = runCommand,
): Promise<string> {
  try {
    const result = await runner(command, arguments_, { timeoutMs: 10_000, maxOutputBytes: 16_384 });
    return `${result.stdout}\n${result.stderr}`.trim().split("\n")[0]?.slice(0, 120) || "unknown";
  } catch {
    return "unknown";
  }
}
