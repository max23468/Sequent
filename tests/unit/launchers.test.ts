import { afterEach, describe, expect, it } from "vitest";
import { getQualifiedSuccessioniOnLineUrl } from "../../src/lib/server/config.ts";
import { getLauncherCapabilities } from "../../src/lib/server/launchers.ts";

afterEach(() => {
  delete process.env.SEQUENT_SUCCESSIONI_ONLINE_URL;
});

describe("launcher locali", () => {
  it("restano subordinati senza configurazione qualificata", () => {
    expect(getLauncherCapabilities().map(({ state }) => state)).toEqual(["unsupported", "unknown"]);
  });

  it("accetta soltanto protocolli esplicitamente ammessi", () => {
    process.env.SEQUENT_SUCCESSIONI_ONLINE_URL = "jnlp:https://example.invalid/SUC13.jnlp";
    expect(getQualifiedSuccessioniOnLineUrl()).toBe("jnlp:https://example.invalid/SUC13.jnlp");
    expect(getLauncherCapabilities()[1]).toMatchObject({
      id: "successioniOnLine",
      state: "available",
      url: "jnlp:https://example.invalid/SUC13.jnlp",
    });
    process.env.SEQUENT_SUCCESSIONI_ONLINE_URL = "https://example.invalid/SUC13.jnlp";
    expect(getQualifiedSuccessioniOnLineUrl()).toBeNull();
    expect(getLauncherCapabilities()[1]).toMatchObject({ state: "unknown", url: null });
  });
});
