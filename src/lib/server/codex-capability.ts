import { resolve } from "node:path";
import { isCodexEnabled } from "./config.ts";
import { requireDedicatedCodexHome } from "./codex-home.ts";
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
  if (process.env.OPENAI_API_KEY) {
    return {
      state: "api_key_disallowed",
      label: "Metodo non ammesso",
      instructions:
        "Sequent usa l’accesso ChatGPT compreso nell’abbonamento; rimuovi la API key dall’ambiente del servizio.",
    };
  }
  let codexHome: string;
  try {
    codexHome = await requireDedicatedCodexHome();
  } catch {
    return {
      state: "unavailable",
      label: "Collegamento non configurato",
      instructions:
        "Configura una home Codex dedicata, privata e senza estensioni prima di collegare ChatGPT.",
    };
  }
  const cliPath = resolve("node_modules", "@openai", "codex", "bin", "codex.js");
  const environmentNames = [
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
  ];
  const environment: NodeJS.ProcessEnv = Object.fromEntries(
    environmentNames.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  );
  environment.CODEX_HOME = codexHome;
  try {
    const result = await runner(process.execPath, [cliPath, "login", "status"], {
      timeoutMs: 15_000,
      maxOutputBytes: 32_768,
      env: environment,
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
    if (/not logged in|signed out|login required/i.test(status)) {
      return {
        state: "signed_out",
        label: "Accesso richiesto",
        instructions:
          "Per collegare Codex, completa l’accesso ChatGPT dal browser dell’amministratore.",
      };
    }
    if (/logged in (?:using|with) chatgpt/i.test(status)) {
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
