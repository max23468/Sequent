import { afterEach, describe, expect, it, vi } from "vitest";
import { actions, load } from "../../src/routes/setup/+page.server.ts";

afterEach(() => vi.unstubAllEnvs());

describe("setup proprietario", () => {
  it("rifiuta GET e POST in Production prima di accedere al database", async () => {
    vi.stubEnv("NODE_ENV", "production");

    let loadFailure: unknown;
    try {
      load({} as never);
    } catch (error) {
      loadFailure = error;
    }
    expect(loadFailure).toMatchObject({
      status: 503,
      body: { message: "Configurazione amministrativa richiesta." },
    });
    await expect(actions.default({} as never)).rejects.toMatchObject({
      status: 503,
      body: { message: "Configurazione amministrativa richiesta." },
    });
  });
});
