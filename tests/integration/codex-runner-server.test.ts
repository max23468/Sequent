import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

function call(socketPath: string, path: string, body?: unknown): Promise<unknown> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const client = request(
      {
        socketPath,
        path,
        method: payload === undefined ? "GET" : "POST",
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    client.on("error", reject);
    if (payload) client.write(payload);
    client.end();
  });
}

async function waitUntilHealthy(socketPath: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`RUNNER_EXITED:${child.exitCode}`);
    try {
      if ((await call(socketPath, "/health")) instanceof Object) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("RUNNER_START_TIMEOUT");
}

describe("server del runner Codex", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it("rifiuta immagini che escono dal workspace della richiesta", async () => {
    const root = await mkdtemp(join(tmpdir(), "sequent-codex-runner-server-"));
    const workspace = join(root, "practice-1");
    const outside = join(root, "outside.png");
    const socket = join(root, "runner.sock");
    await mkdir(workspace);
    await writeFile(outside, "not-an-image");
    const child = spawn(process.execPath, ["src/lib/server/codex-runner-server.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SEQUENT_CODEX_ENABLED: "false",
        SEQUENT_CODEX_RUNNER_LOCAL: "true",
        SEQUENT_CODEX_RUNNER_SOCKET: socket,
        SEQUENT_CODEX_WORKSPACE_ROOT: root,
      },
      stdio: "ignore",
    });
    cleanups.push(
      () => rm(root, { recursive: true, force: true }),
      async () => {
        if (child.exitCode !== null) return;
        child.kill("SIGTERM");
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      },
    );
    await waitUntilHealthy(socket, child);

    await expect(
      call(socket, "/run", {
        workingDirectory: workspace,
        input: [{ type: "local_image", path: outside }],
        threadId: null,
        model: "gpt-5.6-terra",
        effort: "high",
      }),
    ).resolves.toEqual({ ok: false, code: "CODEX_INPUT_OUTSIDE_RUNNER_WORKSPACE" });
  });
});
