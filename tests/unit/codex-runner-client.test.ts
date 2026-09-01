import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getRunnerCodexCapability,
  RunnerCodexAnalysisAdapter,
} from "../../src/lib/server/codex-runner-client.ts";

describe("client del runner Codex", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it("usa il socket Unix senza trasferire documenti fuori dal workspace", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-runner-client-"));
    const socket = join(directory, "runner.sock");
    const received: unknown[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      if (request.url === "/capability") {
        response.end(
          JSON.stringify({
            state: "authenticated",
            label: "Connesso con ChatGPT",
            instructions: "Disponibile",
          }),
        );
        return;
      }
      received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.end(
        JSON.stringify({
          ok: true,
          response: { threadId: "thread-1", finalResponse: "{}", usage: null },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    cleanups.push(
      () => rmSync(directory, { recursive: true, force: true }),
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );

    const adapter = new RunnerCodexAnalysisAdapter(socket);
    await expect(
      adapter.run({
        workingDirectory: "/run/sequent-codex/workspaces/practice-1",
        input: [{ type: "text", text: "contenuto sintetico" }],
        threadId: null,
        model: "gpt-5.6-terra",
        effort: "high",
      }),
    ).resolves.toMatchObject({ threadId: "thread-1" });
    await expect(getRunnerCodexCapability(socket)).resolves.toMatchObject({
      state: "authenticated",
    });
    expect(received).toEqual([
      {
        workingDirectory: "/run/sequent-codex/workspaces/practice-1",
        input: [{ type: "text", text: "contenuto sintetico" }],
        threadId: null,
        model: "gpt-5.6-terra",
        effort: "high",
      },
    ]);
  });

  it("fallisce chiuso se il runner non è raggiungibile", async () => {
    const adapter = new RunnerCodexAnalysisAdapter("/tmp/sequent-runner-assente.sock");
    await expect(
      adapter.run({
        workingDirectory: "/tmp/workspace",
        input: [{ type: "text", text: "test" }],
        threadId: null,
        model: "gpt-5.6-terra",
        effort: "high",
      }),
    ).rejects.toThrow("CODEX_RUNNER_UNAVAILABLE");
  });
});
