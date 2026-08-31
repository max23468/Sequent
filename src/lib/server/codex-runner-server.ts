import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve, sep } from "node:path";
import { getCodexCapability } from "./codex-capability.ts";
import type { CodexRunRequest, CodexRunnerResult } from "./codex-runner-protocol.ts";
import { SdkCodexAnalysisAdapter } from "./codex-sdk-adapter.ts";

const MAX_REQUEST_BYTES = 1024 * 1024;
type CodexRunnerRequest = Omit<CodexRunRequest, "signal" | "onEvent">;

function requiredAbsolutePath(value: string | undefined, code: string): string {
  if (!value?.startsWith("/")) throw new Error(code);
  return value;
}

const socketPath = requiredAbsolutePath(
  process.env.SEQUENT_CODEX_RUNNER_SOCKET,
  "CODEX_RUNNER_SOCKET_REQUIRED",
);
const workspaceRoot = requiredAbsolutePath(
  process.env.SEQUENT_CODEX_WORKSPACE_ROOT,
  "CODEX_WORKSPACE_ROOT_REQUIRED",
);

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("CODEX_RUNNER_REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseRunRequest(value: unknown): CodexRunnerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CODEX_RUNNER_REQUEST_INVALID");
  const request = value as Record<string, unknown>;
  if (
    typeof request.workingDirectory !== "string" ||
    !Array.isArray(request.input) ||
    (request.threadId !== null && typeof request.threadId !== "string") ||
    typeof request.model !== "string" ||
    request.effort !== "high"
  )
    throw new Error("CODEX_RUNNER_REQUEST_INVALID");
  return request as unknown as CodexRunnerRequest;
}

async function assertWorkspace(path: string): Promise<string> {
  const [root, candidate] = await Promise.all([realpath(workspaceRoot), realpath(path)]);
  if (candidate === root || !candidate.startsWith(`${root}${sep}`))
    throw new Error("CODEX_WORKSPACE_OUTSIDE_RUNNER_ROOT");
  return candidate;
}

async function assertInput(input: unknown[], workspace: string): Promise<void> {
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("CODEX_RUNNER_REQUEST_INVALID");
    const entry = item as Record<string, unknown>;
    if (entry.type === "text") {
      if (typeof entry.text !== "string") throw new Error("CODEX_RUNNER_REQUEST_INVALID");
      continue;
    }
    if (entry.type !== "local_image" || typeof entry.path !== "string")
      throw new Error("CODEX_RUNNER_REQUEST_INVALID");
    const image = await realpath(entry.path);
    if (!image.startsWith(`${workspace}${sep}`))
      throw new Error("CODEX_INPUT_OUTSIDE_RUNNER_WORKSPACE");
  }
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_:-]{0,239}$/.test(message) ? message : "CODEX_RUNNER_FAILURE";
}

const adapter = new SdkCodexAnalysisAdapter();
let analysisRunning = false;
const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health")
      return send(response, 200, { ok: true });
    if (request.method === "GET" && request.url === "/capability")
      return send(response, 200, await getCodexCapability());
    if (request.method !== "POST" || request.url !== "/run")
      return send(response, 404, { ok: false });
    if (analysisRunning) throw new Error("CODEX_RUNNER_BUSY");
    const runRequest = parseRunRequest(await readJson(request));
    const workspace = await assertWorkspace(runRequest.workingDirectory);
    if (!Array.isArray(runRequest.input)) throw new Error("CODEX_RUNNER_REQUEST_INVALID");
    await assertInput(runRequest.input, workspace);
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    analysisRunning = true;
    try {
      const result: CodexRunnerResult = {
        ok: true,
        response: await adapter.run({ ...runRequest, signal: controller.signal }),
      };
      return send(response, 200, result);
    } finally {
      analysisRunning = false;
    }
  } catch (error) {
    const result: CodexRunnerResult = { ok: false, code: safeErrorCode(error) };
    return send(response, 200, result);
  }
});

await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
await mkdir(resolve(workspaceRoot), { recursive: true, mode: 0o700 });
try {
  const metadata = await lstat(socketPath);
  if (!metadata.isSocket()) throw new Error("CODEX_RUNNER_SOCKET_NOT_SOCKET");
  await rm(socketPath);
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

server.listen(socketPath);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
