import { resolve } from "node:path";
import { isCodexEnabled } from "./config.ts";
import { runCommand, type CommandRunner } from "./process-tools.ts";

export interface CodexCapability {
  state: "authenticated" | "signed_out" | "api_key_disallowed" | "unavailable" | "disabled";
  label: string;
  instructions: string;
}

export async function getCodexCapability(
  runner: CommandRunner = runCommand,
): Promise<CodexCapability> {
  if (!isCodexEnabled()) {
    return {
      state: "disabled",
      label: "Non attivo",
      instructions: "L’analisi Codex è disattivata in questo ambiente.",
    };
  }
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
          "Sequent usa l’accesso ChatGPT compreso nell’abbonamento; non sono previsti addebiti API separati.",
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
      instructions:
        "Per collegare Codex, completa l’accesso ChatGPT dal browser dell’amministratore.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      state: message.startsWith("TOOL_UNAVAILABLE") ? "unavailable" : "signed_out",
      label: message.startsWith("TOOL_UNAVAILABLE")
        ? "Collegamento non disponibile"
        : "Accesso richiesto",
      instructions: message.startsWith("TOOL_UNAVAILABLE")
        ? "Codex non è installato nell’ambiente in cui opera Sequent."
        : "Per collegare Codex, completa l’accesso ChatGPT dal browser dell’amministratore.",
    };
  }
}
