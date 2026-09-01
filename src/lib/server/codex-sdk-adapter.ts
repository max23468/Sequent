import { Codex, type CodexOptions } from "@openai/codex-sdk";
import { requireDedicatedCodexHome } from "./codex-home.ts";
import type {
  CodexAnalysisAdapter,
  CodexRunRequest,
  CodexRunResponse,
} from "./codex-runner-protocol.ts";

const CODEX_PERMISSION_PROFILE = "sequent_practice";
const CODEX_RUN_TIMEOUT_MS = 15 * 60_000;

const outputSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    proposals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          subjectId: { type: "string", minLength: 1 },
          label: { type: "string" },
          value: { type: ["string", "null"] },
          documentId: { type: "string" },
          pageNumber: { type: "integer", minimum: 1 },
          excerpt: { type: "string", minLength: 1, pattern: "\\S" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          alternatives: { type: "array", items: { type: "string" } },
        },
        required: [
          "subjectId",
          "label",
          "value",
          "documentId",
          "pageNumber",
          "excerpt",
          "confidence",
          "alternatives",
        ],
        additionalProperties: false,
      },
    },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          subjectId: { type: "string", minLength: 1 },
          label: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                documentId: { type: "string" },
                pageNumber: { type: "integer", minimum: 1 },
                excerpt: { type: "string", minLength: 1, pattern: "\\S" },
                value: { type: "string" },
              },
              required: ["documentId", "pageNumber", "excerpt", "value"],
              additionalProperties: false,
            },
          },
          explanation: { type: "string" },
        },
        required: ["subjectId", "label", "sources", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "proposals", "conflicts"],
  additionalProperties: false,
} as const;

export function createCodexRunSignal(
  requestSignal: AbortSignal | undefined,
  timeoutSignal = AbortSignal.timeout(CODEX_RUN_TIMEOUT_MS),
): { signal: AbortSignal; timedOut: () => boolean } {
  return {
    signal: requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal,
    timedOut: () => timeoutSignal.aborted && !requestSignal?.aborted,
  };
}

export function buildCodexRuntimeOptions(
  workingDirectory: string,
  codexHome: string,
): CodexOptions {
  const environmentEntries = [
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
  ]
    .map((name) => [name, process.env[name]] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined);
  const environment: Record<string, string> = Object.fromEntries(environmentEntries);
  environment.CODEX_HOME = codexHome;
  const workspacePath = JSON.stringify(workingDirectory);
  return {
    env: environment,
    config: {
      forced_login_method: "chatgpt",
      cli_auth_credentials_store: "file",
      default_permissions: CODEX_PERMISSION_PROFILE,
      features: {
        apps: false,
        browser_use: false,
        browser_use_external: false,
        code_mode_host: true,
        computer_use: false,
        hooks: false,
        image_generation: false,
        memories: false,
        multi_agent: false,
        plugins: false,
        remote_plugin: false,
        skill_search: false,
        shell_tool: true,
        tool_suggest: false,
        view_image: false,
      },
    },
    configOverrides: [
      `permissions.${CODEX_PERMISSION_PROFILE}.filesystem={":minimal"="read",":root"="deny","/app/node_modules/@openai"="read",${workspacePath}="read"}`,
      `permissions.${CODEX_PERMISSION_PROFILE}.network={enabled=false}`,
      "mcp_servers={}",
      "hooks={}",
    ],
  };
}

export class SdkCodexAnalysisAdapter implements CodexAnalysisAdapter {
  async run(request: CodexRunRequest): Promise<CodexRunResponse> {
    const codexHome = await requireDedicatedCodexHome();
    const codex = new Codex(buildCodexRuntimeOptions(request.workingDirectory, codexHome));
    const options = {
      model: request.model,
      modelReasoningEffort: request.effort,
      workingDirectory: request.workingDirectory,
      skipGitRepoCheck: true,
      approvalPolicy: "never" as const,
      webSearchMode: "disabled" as const,
      threadSource: "sequent-practice-analysis",
    };
    const thread = request.threadId
      ? codex.resumeThread(request.threadId, options)
      : codex.startThread(options);
    const runSignal = createCodexRunSignal(request.signal);
    const streamed = await thread.runStreamed(request.input, {
      outputSchema,
      signal: runSignal.signal,
    });
    let finalResponse = "";
    let usage = null;
    let observedThreadId = request.threadId;
    try {
      for await (const event of streamed.events) {
        request.onEvent?.(event);
        if (event.type === "thread.started") observedThreadId = event.thread_id;
        if (event.type === "item.completed" && event.item.type === "agent_message")
          finalResponse = event.item.text;
        if (event.type === "turn.completed") usage = event.usage;
        if (event.type === "turn.failed")
          throw new Error(`CODEX_TURN_FAILED:${event.error.message}`);
        if (event.type === "error") throw new Error(`CODEX_STREAM_FAILED:${event.message}`);
      }
    } catch (error) {
      if (runSignal.timedOut()) throw new Error("CODEX_TIMEOUT");
      throw error;
    }
    const threadId = observedThreadId ?? thread.id;
    if (!threadId) throw new Error("CODEX_THREAD_ID_MISSING");
    if (!finalResponse) throw new Error("CODEX_EMPTY_RESPONSE");
    return { threadId, finalResponse, usage };
  }
}
