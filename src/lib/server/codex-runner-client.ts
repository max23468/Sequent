import { request } from "node:http";
import type { CodexCapability } from "./codex-capability.ts";
import type {
  CodexAnalysisAdapter,
  CodexRunRequest,
  CodexRunnerResult,
} from "./codex-runner-protocol.ts";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function callRunner<T>(
  socketPath: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<T>((resolve, reject) => {
    const runnerRequest = request(
      {
        socketPath,
        path,
        method: payload === undefined ? "GET" : "POST",
        headers:
          payload === undefined
            ? undefined
            : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
        signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(new Error("CODEX_RUNNER_RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
            if (response.statusCode !== 200) throw new Error("CODEX_RUNNER_UNAVAILABLE");
            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    runnerRequest.on("error", () => reject(new Error("CODEX_RUNNER_UNAVAILABLE")));
    if (payload !== undefined) runnerRequest.write(payload);
    runnerRequest.end();
  });
}

export class RunnerCodexAnalysisAdapter implements CodexAnalysisAdapter {
  private readonly socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async run(input: CodexRunRequest) {
    const result = await callRunner<CodexRunnerResult>(
      this.socketPath,
      "/run",
      {
        workingDirectory: input.workingDirectory,
        input: input.input,
        threadId: input.threadId,
        model: input.model,
        effort: input.effort,
      },
      input.signal,
    );
    if (!result.ok) throw new Error(result.code);
    return result.response;
  }
}

export function getRunnerCodexCapability(socketPath: string): Promise<CodexCapability> {
  return callRunner<CodexCapability>(socketPath, "/capability");
}
