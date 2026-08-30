import { describe, expect, it } from "vitest";
import { documentContentHeaders } from "../../src/lib/document-content-headers.ts";

describe("header dei contenuti documentali", () => {
  it("confina nello stesso modo contenuti online e ricostruiti offline", () => {
    expect(
      documentContentHeaders({
        mediaType: "text/html",
        byteSize: 42,
        fileName: "prova\r\nattiva.html",
        fallbackName: "documento",
      }),
    ).toMatchObject({
      "Content-Type": "text/html",
      "Content-Length": "42",
      "Content-Disposition": expect.stringContaining("prova__attiva.html"),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    });
  });
});
