import { describe, expect, it } from "vitest";
import { resolvePageTitle } from "../../src/lib/page-title";

describe("resolvePageTitle", () => {
  it.each([
    ["/", "Dashboard · Sequent"],
    ["/pratiche", "Pratiche · Sequent"],
    ["/documenti", "Documenti · Sequent"],
    ["/impostazioni", "Impostazioni · Sequent"],
    ["/login", "Accedi · Sequent"],
    ["/setup", "Configurazione · Sequent"],
    ["/__design", "Design Lab · Sequent"],
  ])("maps %s to %s", (pathname, expected) => {
    expect(resolvePageTitle(pathname)).toBe(expected);
  });

  it("uses a generic practice title for nested practice routes", () => {
    expect(resolvePageTitle("/pratiche/example")).toBe("Pratica · Sequent");
  });

  it("falls back to the product name for unknown routes", () => {
    expect(resolvePageTitle("/unknown")).toBe("Sequent");
  });
});
