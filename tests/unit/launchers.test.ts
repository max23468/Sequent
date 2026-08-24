import { afterEach, describe, expect, it } from "vitest";
import { getQualifiedLauncherUrl } from "../../src/lib/server/config.ts";
import { getLauncherCapabilities } from "../../src/lib/server/launchers.ts";

afterEach(() => {
  delete process.env.SEQUENT_DESKTOP_TELEMATICO_URL;
  delete process.env.SEQUENT_SUCCESSIONI_ONLINE_URL;
});

describe("launcher locali", () => {
  it("restano subordinati senza configurazione qualificata", () => {
    expect(getLauncherCapabilities().map(({ state }) => state)).toEqual(["unsupported", "unknown"]);
  });

  it("accetta soltanto protocolli esplicitamente ammessi", () => {
    process.env.SEQUENT_SUCCESSIONI_ONLINE_URL = "jnlp:https://example.invalid/SUC13.jnlp";
    process.env.SEQUENT_DESKTOP_TELEMATICO_URL = "file:///Applications/DesktopTelematico.app";
    expect(getQualifiedLauncherUrl("successioniOnLine")).toBe(
      "jnlp:https://example.invalid/SUC13.jnlp",
    );
    expect(getQualifiedLauncherUrl("desktopTelematico")).toBeNull();
  });
});
