import { getQualifiedLauncherUrl } from "./config.ts";

type LauncherState = "available" | "unsupported" | "unknown";

export interface LauncherCapability {
  id: "desktopTelematico" | "successioniOnLine";
  label: "Desktop Telematico" | "SuccessioniOnLine";
  state: LauncherState;
  url: string | null;
  instructions: string;
}

export function getLauncherCapabilities(): LauncherCapability[] {
  const desktopUrl = getQualifiedLauncherUrl("desktopTelematico");
  const successioniUrl = getQualifiedLauncherUrl("successioniOnLine");
  return [
    {
      id: "desktopTelematico",
      label: "Desktop Telematico",
      state: desktopUrl ? "available" : "unsupported",
      url: desktopUrl,
      instructions:
        "Apri Desktop Telematico dalla cartella Applicazioni. Sequent non trasmette dichiarazioni e non controlla il programma.",
    },
    {
      id: "successioniOnLine",
      label: "SuccessioniOnLine",
      state: successioniUrl ? "available" : "unknown",
      url: successioniUrl,
      instructions:
        "Apri il file SUC13.jnlp con OpenWebStart. Il collegamento diretto resta disabilitato finché il browser non è qualificato.",
    },
  ];
}
