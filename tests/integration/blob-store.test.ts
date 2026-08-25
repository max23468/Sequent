import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupStaleUploads, persistUpload, verifyBlob } from "../../src/lib/server/blob-store.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("content-addressed store", () => {
  it("sincronizza la directory del blob prima di rimuovere il temporaneo", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-blob-durability-"));
    directories.push(directory);
    let synchronizedDirectory = "";

    const stored = await persistUpload(
      new File(["byte durevoli"], "durevole.txt", { type: "text/plain" }),
      directory,
      (directoryPath) => {
        synchronizedDirectory = directoryPath;
        expect(readdirSync(join(directory, "tmp"))).toEqual([expect.stringMatching(/\.upload$/)]);
      },
    );

    expect(synchronizedDirectory).toBe(join(directory, "blobs", stored.sha256.slice(0, 2)));
    expect(readdirSync(join(directory, "tmp"))).toEqual([]);
    expect(readFileSync(join(directory, stored.blobPath), "utf8")).toBe("byte durevoli");
  });

  it("scrive il file per hash e normalizza un nome proveniente da Windows", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-blob-"));
    directories.push(directory);
    const file = new File(["contenuto immutabile"], "C:\\documenti\\visura.txt", {
      type: "text/plain",
    });
    const stored = await persistUpload(file, directory);
    await expect(verifyBlob(directory, stored.blobPath, stored.sha256)).resolves.toBeUndefined();
    expect(readFileSync(join(directory, stored.blobPath), "utf8")).toBe("contenuto immutabile");
    expect(stored.originalName).toBe("visura.txt");
  });

  it("deduplica i byte identici nella stessa pratica senza riscrivere l'originale", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-blob-"));
    directories.push(directory);
    const first = await persistUpload(
      new File(["stessi byte"], "prima-copia.pdf", { type: "application/pdf" }),
      directory,
    );
    const duplicate = await persistUpload(
      new File(["stessi byte"], "seconda-copia.pdf", { type: "application/pdf" }),
      directory,
    );

    expect(duplicate).toMatchObject({
      sha256: first.sha256,
      byteSize: first.byteSize,
      blobPath: first.blobPath,
    });
    expect(readFileSync(join(directory, first.blobPath), "utf8")).toBe("stessi byte");
  });

  it("ripristina il blob mancante o corrotto quando riceve di nuovo gli stessi byte", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-blob-repair-"));
    directories.push(directory);
    const upload = () =>
      persistUpload(
        new File(["originale integro"], "originale.txt", { type: "text/plain" }),
        directory,
      );
    const first = await upload();
    const absoluteBlobPath = join(directory, first.blobPath);

    rmSync(absoluteBlobPath);
    expect(await upload()).toEqual(first);
    expect(readFileSync(absoluteBlobPath, "utf8")).toBe("originale integro");

    writeFileSync(absoluteBlobPath, "contenuto corrotto");
    expect(await upload()).toEqual(first);
    expect(readFileSync(absoluteBlobPath, "utf8")).toBe("originale integro");
    await expect(verifyBlob(directory, first.blobPath, first.sha256)).resolves.toBeUndefined();
  });

  it("rimuove soltanto i temporanei di upload oltre il grace period", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-upload-cleanup-"));
    directories.push(directory);
    const temporaryDirectory = join(directory, "tmp");
    mkdirSync(temporaryDirectory, { recursive: true });
    const stale = join(temporaryDirectory, "stale.upload");
    const recent = join(temporaryDirectory, "recent.upload");
    const unrelated = join(temporaryDirectory, "keep.txt");
    writeFileSync(stale, "stale");
    writeFileSync(recent, "recent");
    writeFileSync(unrelated, "keep");
    const now = Date.now();
    utimesSync(stale, new Date(now - 7 * 60 * 60 * 1_000), new Date(now - 7 * 60 * 60 * 1_000));

    await expect(cleanupStaleUploads(directory, now)).resolves.toBe(1);
    expect(readdirSync(temporaryDirectory).sort()).toEqual(["keep.txt", "recent.upload"]);
  });
});
