import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import {
  addOfficialArtifact,
  confirmPresentation,
  getImportedDizContent,
  getOfficialFlowSummary,
  importDiz,
  materializeImportedDizAttachments,
  overrideOfficialStage,
  repairImportedDizAcquisition,
} from "../../src/lib/server/official-flow.ts";
import { listSharedAssets } from "../../src/lib/server/domain-assets.ts";
import {
  createSharedSubject,
  listDeclarationSubjectEntries,
  listSharedSubjects,
} from "../../src/lib/server/domain-subjects.ts";
import {
  getDeclaration,
  createPractice,
  listPracticeDocuments,
} from "../../src/lib/server/practices.ts";
import { syntheticDiz, syntheticDizFromFields } from "../fixtures/synthetic-diz.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("flusso ufficiale persistente", () => {
  it("crea il target applicativo mancante e lo popola dal DIZ", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-official-flow-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica DIZ sintetica");

    const artifact = await importDiz(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      file: new File([new Uint8Array(syntheticDiz())], "pratica.diz", {
        type: "application/zip",
      }),
      dataDirectory: directory,
    });

    expect(artifact.kind).toBe("diz-imported");
    expect(artifact.metadata).toMatchObject({
      format: "xstream-zip-v1",
      fields: 1,
      acquisition: {
        version: 2,
        mappedFields: 1,
        importedFields: 1,
        missingTargets: 0,
        preservedFields: 0,
        createdSubjects: 1,
      },
    });
    expect(
      database.prepare("SELECT reason, declaration_revision FROM declaration_snapshots").get(),
    ).toEqual({ reason: "diz-import", declaration_revision: 1 });
    expect(
      database
        .prepare("SELECT revision FROM declarations WHERE id = ?")
        .get(practice.declarationId),
    ).toEqual({ revision: 2 });
    expect(getOfficialFlowSummary(database, practice.id, practice.declarationId)).toMatchObject({
      stage: "diz-imported",
      stageLabel: "DIZ di partenza acquisito",
    });
  });

  it("importa i campi DIZ qualificati nella posizione corretta senza confermarli", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-official-flow-fields-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica DIZ con soggetto");
    const subject = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Soggetto da DIZ",
      declarationId: practice.declarationId,
    });

    const artifact = await importDiz(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      file: new File([new Uint8Array(syntheticDiz("VERDI"))], "pratica.diz", {
        type: "application/zip",
      }),
      dataDirectory: directory,
    });

    expect(artifact.metadata).toMatchObject({
      acquisition: {
        version: 2,
        mappedFields: 1,
        importedFields: 1,
        unchangedFields: 0,
        conflictingFields: 0,
        missingTargets: 0,
      },
    });
    const declaration = getDeclaration(database, practice.declarationId, practice.id)?.declaration;
    expect(
      Object.values(declaration?.fields ?? {}).find(
        (field) => field.entityId === subject.id && field.value === "VERDI",
      ),
    ).toMatchObject({
      fieldId: "quadro-ea.soggetto.dati-anagrafici.cognome",
      state: "to_review",
      sourceRefs: expect.arrayContaining([
        expect.stringMatching(/^DIZ acquisito · SHA-256 [a-f0-9]{64}$/),
      ]),
    });
    expect(
      database.prepare("SELECT reason, declaration_revision FROM declaration_snapshots").get(),
    ).toEqual({ reason: "diz-import", declaration_revision: 1 });
    expect(
      database
        .prepare("SELECT revision FROM declarations WHERE id = ?")
        .get(practice.declarationId),
    ).toEqual({ revision: 2 });
  });

  it("rende consultabili i valori preservati e materializza gli allegati incorporati", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-official-flow-content-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica DIZ completa");
    createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Soggetto da DIZ",
      declarationId: practice.declarationId,
    });
    const attachment = Buffer.from("%PDF-1.7\nAllegato sintetico\n%%EOF", "ascii");

    const artifact = await importDiz(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      file: new File(
        [new Uint8Array(syntheticDiz("VERDI", { name: "allegato.pdf", content: attachment }))],
        "pratica-con-allegato.diz",
        { type: "application/zip" },
      ),
      dataDirectory: directory,
    });

    expect(listPracticeDocuments(database, practice.id)).toEqual([
      expect.objectContaining({
        originalName: "allegato.pdf",
        mediaType: "application/pdf",
        byteSize: attachment.length,
      }),
    ]);
    await expect(
      getImportedDizContent(database, practice.id, practice.declarationId, directory),
    ).resolves.toMatchObject({
      integratedFields: 1,
      preservedFields: 0,
      fieldCount: 1,
      sections: [
        expect.objectContaining({
          quadro: "EA",
          fields: [expect.objectContaining({ field: "001005", value: "VERDI" })],
        }),
      ],
      attachments: [expect.objectContaining({ name: "allegato.pdf", kind: "pdf" })],
      attachmentEvidence: {
        status: "embedded",
        embeddedCount: 1,
        embeddedBytes: attachment.length,
      },
    });

    database.prepare("DELETE FROM documents WHERE practice_id = ?").run(practice.id);
    await expect(
      materializeImportedDizAttachments(database, {
        practiceId: practice.id,
        artifactId: artifact.id,
        dataDirectory: directory,
      }),
    ).resolves.toEqual({ attachments: 1, documents: 1 });
    expect(listPracticeDocuments(database, practice.id)).toHaveLength(1);
  });

  it("materializza soggetti e cespiti multipli presenti nello stesso modulo", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-official-flow-entities-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica DIZ con più entità");
    const bytes = syntheticDizFromFields([
      { quadro: "EA", module: "00000001", field: "001005", value: "PRIMO" },
      { quadro: "EA", module: "00000001", field: "002005", value: "SECONDO" },
      { quadro: "EA", module: "00000001", field: "003005", value: "TERZO" },
      { quadro: "EA", module: "00000002", field: "001005", value: "QUARTO" },
      { quadro: "EC", module: "00000001", field: "001003", value: "A001" },
      { quadro: "EC", module: "00000001", field: "002003", value: "A002" },
      { quadro: "ER", module: "00000001", field: "001001", value: "BI" },
      { quadro: "B", module: "00000001", field: "2", value: "RSSMRA80A01H501U" },
    ]);

    const artifact = await importDiz(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      file: new File([new Uint8Array(bytes)], "entita.diz"),
      dataDirectory: directory,
    });

    expect(artifact.metadata.acquisition).toMatchObject({
      mappedFields: 8,
      importedFields: 8,
      preservedFields: 0,
      createdSubjects: 4,
      createdAssets: 3,
      createdDecedent: true,
    });
    expect(
      listDeclarationSubjectEntries(database, practice.id, practice.declarationId),
    ).toHaveLength(4);
    expect(
      listSharedSubjects(database, practice.id).filter((subject) => subject.role === "decedent"),
    ).toHaveLength(1);
    expect(listSharedAssets(database, practice.id, practice.declarationId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "building" }),
        expect.objectContaining({ kind: "inventory" }),
      ]),
    );
    expect(listSharedAssets(database, practice.id, practice.declarationId)).toHaveLength(3);
  });

  it("ripara in modo idempotente una precedente acquisizione parziale e gli allegati", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-official-flow-repair-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica DIZ da riparare");
    const attachment = Buffer.from("%PDF-1.7\nRiparazione\n%%EOF", "ascii");
    const artifact = await importDiz(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      file: new File(
        [new Uint8Array(syntheticDiz("ROSSI", { name: "prova.pdf", content: attachment }))],
        "riparazione.diz",
      ),
      dataDirectory: directory,
    });
    database.prepare("DELETE FROM documents WHERE practice_id = ?").run(practice.id);
    database
      .prepare("UPDATE official_artifacts SET metadata_json = ? WHERE id = ?")
      .run(
        JSON.stringify({ ...artifact.metadata, acquisition: { importedFields: 1 } }),
        artifact.id,
      );

    const first = await repairImportedDizAcquisition(database, {
      practiceId: practice.id,
      artifactId: artifact.id,
      dataDirectory: directory,
    });
    const second = await repairImportedDizAcquisition(database, {
      practiceId: practice.id,
      artifactId: artifact.id,
      dataDirectory: directory,
    });

    expect(first).toMatchObject({ mappedFields: 1, unchangedFields: 1, missingTargets: 0 });
    expect(second).toMatchObject({ mappedFields: 1, unchangedFields: 1, missingTargets: 0 });
    expect(
      listDeclarationSubjectEntries(database, practice.id, practice.declarationId),
    ).toHaveLength(1);
    expect(listPracticeDocuments(database, practice.id)).toHaveLength(1);
  });

  it("non sovrascrive un valore già presente quando il DIZ diverge", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-official-flow-conflict-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica DIZ con divergenza");
    createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "BIANCHI",
      declarationId: practice.declarationId,
    });
    const first = await importDiz(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      file: new File([new Uint8Array(syntheticDiz("BIANCHI"))], "prima.diz"),
      dataDirectory: directory,
    });
    const second = await importDiz(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      file: new File([new Uint8Array(syntheticDiz("NERI"))], "seconda.diz"),
      dataDirectory: directory,
    });

    expect(first.metadata).toMatchObject({ acquisition: { importedFields: 1 } });
    expect(second.metadata).toMatchObject({
      acquisition: { importedFields: 0, conflictingFields: 1, preservedFields: 1 },
    });
    expect(
      Object.values(
        getDeclaration(database, practice.declarationId, practice.id)?.declaration.fields ?? {},
      ).find((field) => field.fieldId === "quadro-ea.soggetto.dati-anagrafici.cognome")?.value,
    ).toBe("BIANCHI");
  });

  it("serializza i cicli DIZ e blocca anche una nuova base finché il ciclo è aperto", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-official-roundtrip-lock-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica con ciclo DIZ aperto");
    const first = await importDiz(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      file: new File([new Uint8Array(syntheticDiz())], "prima-base.diz"),
      dataDirectory: directory,
    });
    const second = await importDiz(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      file: new File([new Uint8Array(syntheticDiz())], "seconda-base.diz"),
      dataDirectory: directory,
    });
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO diz_round_trips(
           id, practice_id, declaration_id, source_artifact_id, export_artifact_id,
           base_declaration_revision, base_fields_json, opaque_evidence_json,
           compliance_report_json, status, created_at
         ) VALUES ('ciclo-aperto', ?, ?, ?, ?, 1, '[]', '{}', '{}', 'exported', ?)`,
      )
      .run(practice.id, practice.declarationId, first.id, second.id, now);

    await expect(
      importDiz(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        file: new File([new Uint8Array(syntheticDiz())], "terza-base.diz"),
        dataDirectory: directory,
      }),
    ).rejects.toThrow("DIZ_ROUND_TRIP_PENDING");
    expect(() =>
      database
        .prepare(
          `INSERT INTO diz_round_trips(
             id, practice_id, declaration_id, source_artifact_id, export_artifact_id,
             base_declaration_revision, base_fields_json, opaque_evidence_json,
             compliance_report_json, status, created_at
           ) VALUES ('secondo-ciclo', ?, ?, ?, ?, 1, '[]', '{}', '{}', 'conflicts', ?)`,
        )
        .run(practice.id, practice.declarationId, second.id, first.id, now),
    ).toThrow();
  });

  it("non considera presentata la pratica senza seconda ricevuta positiva completa", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-official-receipts-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica ricevute sintetiche");
    const common = {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      file: new File(["ricevuta sintetica"], "ricevuta.pdf", { type: "application/pdf" }),
      dataDirectory: directory,
    };

    await addOfficialArtifact(database, { ...common, kind: "receipt-first" });
    expect(getOfficialFlowSummary(database, practice.id, practice.declarationId).stage).toBe(
      "transmitted",
    );
    await expect(
      addOfficialArtifact(database, {
        ...common,
        kind: "receipt-second",
        metadata: { outcome: "positive" },
      }),
    ).rejects.toThrow("SECOND_RECEIPT_REGISTRATION_REQUIRED");

    await addOfficialArtifact(database, {
      ...common,
      kind: "receipt-second",
      metadata: {
        outcome: "positive",
        registeredAt: "2026-08-30",
        registrationReference: "REG-SINTETICA",
      },
    });
    expect(getOfficialFlowSummary(database, practice.id, practice.declarationId)).toMatchObject({
      stage: "presented",
      stageLabel: "Presentata e registrata",
    });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM declaration_snapshots WHERE reason = 'presentation'",
        )
        .get(),
    ).toEqual({ count: 1 });

    await addOfficialArtifact(database, {
      ...common,
      kind: "cadastral-result",
      metadata: { outcome: "partial" },
    });
    expect(getOfficialFlowSummary(database, practice.id, practice.declarationId).stage).toBe(
      "cadastral-processing",
    );
    await addOfficialArtifact(database, {
      ...common,
      kind: "cadastral-result",
      metadata: { outcome: "complete" },
    });
    expect(getOfficialFlowSummary(database, practice.id, practice.declarationId).stage).toBe(
      "closed",
    );
    expect(
      database
        .prepare("SELECT reason, count(*) AS count FROM declaration_snapshots GROUP BY reason")
        .all(),
    ).toEqual([
      { reason: "closure", count: 1 },
      { reason: "presentation", count: 1 },
    ]);
  });

  it("ammette la conferma manuale solo con motivazione ed estremi ufficiali", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-official-confirmation-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica con ricevuta non ottenibile");

    expect(() =>
      confirmPresentation(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        reason: "Troppo breve",
        registrationReference: "REG-SINTETICA",
        registeredAt: "2026-08-30",
      }),
    ).toThrow("PRESENTATION_REASON_INVALID");

    confirmPresentation(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      reason: "Il servizio ufficiale non rende disponibile il file della seconda ricevuta.",
      registrationReference: "REG-SINTETICA",
      registeredAt: "2026-08-30",
    });
    const summary = getOfficialFlowSummary(database, practice.id, practice.declarationId);
    expect(summary).toMatchObject({ stage: "presented" });
    expect(summary.events).toHaveLength(1);
    expect(database.prepare("SELECT reason FROM declaration_snapshots").all()).toEqual([
      { reason: "presentation" },
    ]);
    expect(() =>
      overrideOfficialStage(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        stage: "closed",
        reason: "Correzione sintetica priva dell’esito catastale richiesto.",
      }),
    ).toThrow("OFFICIAL_STAGE_EVIDENCE_REQUIRED");
    overrideOfficialStage(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      stage: "transmitted",
      reason: "La conferma precedente è stata registrata sullo stato operativo errato.",
    });
    expect(getOfficialFlowSummary(database, practice.id, practice.declarationId)).toMatchObject({
      stage: "transmitted",
      stageOverride: { stage: "transmitted" },
    });
    expect(() =>
      confirmPresentation(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        reason: "Il servizio ufficiale continua a non rendere disponibile la ricevuta.",
        registrationReference: "REG-SINTETICA",
        registeredAt: "2026-08-30",
      }),
    ).toThrow("PRESENTATION_ALREADY_CONFIRMED");
  });
});
