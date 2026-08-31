import type { Input, ThreadEvent, Usage } from "@openai/codex-sdk";

export interface CodexRunRequest {
  workingDirectory: string;
  input: Input;
  threadId: string | null;
  model: string;
  effort: "high";
  signal?: AbortSignal;
  onEvent?: (event: ThreadEvent) => void;
}

export interface CodexRunResponse {
  threadId: string;
  finalResponse: string;
  usage: Usage | null;
}

export interface CodexAnalysisAdapter {
  run(request: CodexRunRequest): Promise<CodexRunResponse>;
}

export type CodexRunnerResult =
  | { ok: true; response: CodexRunResponse }
  | { ok: false; code: string };
