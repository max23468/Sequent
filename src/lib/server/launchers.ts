import { getQualifiedSuccessioniOnLineUrl, isDizEnabled } from "./config.ts";

type LauncherState = "available" | "unsupported" | "unknown" | "disabled";

export interface LauncherCapability {
  id: "desktopTelematico" | "successioniOnLine";
  label: "Desktop Telematico" | "SuccessioniOnLine";
  state: LauncherState;
  url: string | null;
  instructions: string;
}

export function getLauncherCapabilities(): LauncherCapability[] {
  const dizEnabled = isDizEnabled();
  const successioniUrl = getQualifiedSuccessioniOnLineUrl();
  return [
    {
      id: "desktopTelematico",
      label: "Desktop Telematico",
      state: "unsupported",
      url: null,
      instructions:
        "Apri Desktop Telematico dalla cartella Applicazioni. Sequent non trasmette dichiarazioni e non controlla il programma.",
    },
    {
      id: "successioniOnLine",
      label: "SuccessioniOnLine",
      state: !dizEnabled ? "disabled" : successioniUrl ? "available" : "unknown",
      url: successioniUrl,
      instructions: dizEnabled
        ? "Apri il collegamento con OpenWebStart. L’avvio diretto resta disabilitato finché il collegamento non è stato verificato."
        : "L’interoperabilità DIZ è disattivata in questo ambiente.",
    },
  ];
}
