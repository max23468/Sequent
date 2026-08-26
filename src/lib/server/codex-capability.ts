import { resolve } from "node:path";
import { runCommand, type CommandRunner } from "./process-tools.ts";

export interface CodexCapability {
  state: "authenticated" | "signed_out" | "api_key_disallowed" | "unavailable";
  label: string;
  instructions: string;
}

export async function getCodexCapability(
  runner: CommandRunner = runCommand,
): Promise<CodexCapability> {
  const cliPath = resolve("node_modules", "@openai", "codex", "bin", "codex.js");
  try {
    const result = await runner(process.execPath, [cliPath, "login", "status"], {
      timeoutMs: 15_000,
      maxOutputBytes: 32_768,
    });
    const status = `${result.stdout}\n${result.stderr}`;
    if (/api key/i.test(status)) {
      return {
        state: "api_key_disallowed",
        label: "Metodo non ammesso",
        instructions:
          "Sequent richiede l’accesso ChatGPT incluso nella subscription e non usa API key a consumo.",
      };
    }
    if (/chatgpt|logged in/i.test(status)) {
      return {
        state: "authenticated",
        label: "Connesso con ChatGPT",
        instructions:
          "La sessione Codex è disponibile. Le analisi della pratica restano avviate solo su comando.",
      };
    }
    return {
      state: "signed_out",
      label: "Accesso richiesto",
      instructions: "Esegui codex login --device-auth sulla VPS e completa l’accesso dal browser.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      state: message.startsWith("TOOL_UNAVAILABLE") ? "unavailable" : "signed_out",
      label: message.startsWith("TOOL_UNAVAILABLE") ? "CLI non disponibile" : "Accesso richiesto",
      instructions: message.startsWith("TOOL_UNAVAILABLE")
        ? "Il runtime non contiene la CLI Codex richiesta dall’SDK."
        : "Esegui codex login --device-auth sulla VPS e completa l’accesso dal browser.",
    };
  }
}
