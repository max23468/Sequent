import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resumableUploadInternals,
  uploadFilesResumably,
} from "../../src/lib/client/resumable-upload.ts";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client upload riprendibile", () => {
  it("riprende il secondo file nella stessa pratica dopo un reload", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const files = [
      new File(["primo"], "primo.txt", { type: "text/plain", lastModified: 1 }),
      new File(["secondo"], "secondo.txt", { type: "text/plain", lastModified: 2 }),
    ];
    const createdTargets: unknown[] = [];
    let createdSessions = 0;
    let interruptedSecondFile = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/uploads" && init?.method === "POST") {
          createdTargets.push(JSON.parse(String(init.body)));
          createdSessions += 1;
          return jsonResponse({ id: `session-${createdSessions}`, offset: 0 });
        }
        if (url === "/api/uploads/session-2" && !init?.method) {
          return jsonResponse({ originalName: "secondo.txt", totalSize: 7, offset: 0 });
        }
        if (url === "/api/uploads/session-1" && init?.method === "PATCH") {
          return jsonResponse({ offset: 5 });
        }
        if (url === "/api/uploads/session-2" && init?.method === "PATCH") {
          if (!interruptedSecondFile) {
            interruptedSecondFile = true;
            throw new Error("CONNECTION_LOST");
          }
          return jsonResponse({ offset: 7 });
        }
        if (url === "/api/uploads/session-1/complete") {
          return jsonResponse({
            practiceId: "practice-1",
            documentId: "document-1",
            location: "/pratiche/practice-1?documento=document-1",
          });
        }
        if (url === "/api/uploads/session-2/complete") {
          return jsonResponse({
            practiceId: "practice-1",
            documentId: "document-2",
            location: "/pratiche/practice-1?documento=document-2",
          });
        }
        throw new Error(`UNEXPECTED_REQUEST:${url}:${init?.method ?? "GET"}`);
      }),
    );

    await expect(
      uploadFilesResumably(files, { newPracticeTitle: "Pratica batch" }, () => {}),
    ).rejects.toThrow("CONNECTION_LOST");
    await expect(
      uploadFilesResumably(files, { newPracticeTitle: "Pratica batch" }, () => {}),
    ).resolves.toMatchObject({ practiceId: "practice-1", documentId: "document-2" });

    expect(createdSessions).toBe(2);
    expect(createdTargets).toEqual([
      expect.objectContaining({ newPracticeTitle: "Pratica batch", originalName: "primo.txt" }),
      expect.objectContaining({ practiceId: "practice-1", originalName: "secondo.txt" }),
    ]);
  });

  it("non riprende una sessione di un file diverso con gli stessi metadati", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const first = new File(["AAAA"], "stesso.txt", { type: "text/plain", lastModified: 10 });
    const second = new File(["BBBB"], "stesso.txt", { type: "text/plain", lastModified: 10 });
    expect(await resumableUploadInternals.fileFingerprint(first)).not.toBe(
      await resumableUploadInternals.fileFingerprint(second),
    );
    let createdSessions = 0;
    let statusReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/uploads" && init?.method === "POST") {
          createdSessions += 1;
          return jsonResponse({ id: `collision-${createdSessions}`, offset: 0 });
        }
        if (!init?.method) {
          statusReads += 1;
          return jsonResponse({ originalName: "stesso.txt", totalSize: 4, offset: 2 });
        }
        if (init?.method === "PATCH") throw new Error("CONNECTION_LOST");
        throw new Error(`UNEXPECTED_REQUEST:${url}:${init?.method ?? "GET"}`);
      }),
    );

    await expect(
      uploadFilesResumably([first], { practiceId: "practice-1" }, () => {}),
    ).rejects.toThrow("CONNECTION_LOST");
    await expect(
      uploadFilesResumably([second], { practiceId: "practice-1" }, () => {}),
    ).rejects.toThrow("CONNECTION_LOST");

    expect(createdSessions).toBe(2);
    expect(statusReads).toBe(0);
  });
});
