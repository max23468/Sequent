import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import {
  addOfficialArtifact,
  confirmPresentation,
  getOfficialFlowSummary,
  importDiz,
  overrideOfficialStage,
} from "../../src/lib/server/official-flow.ts";
import { createPractice } from "../../src/lib/server/practices.ts";
import { syntheticDiz } from "../fixtures/synthetic-diz.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("flusso ufficiale persistente", () => {
  it("acquisisce un DIZ senza modificare la dichiarazione e crea lo snapshot preventivo", async () => {
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
    expect(artifact.metadata).toMatchObject({ format: "xstream-zip-v1", fields: 1 });
    expect(
      database.prepare("SELECT reason, declaration_revision FROM declaration_snapshots").get(),
    ).toEqual({ reason: "diz-import", declaration_revision: 1 });
    expect(
      database
        .prepare("SELECT revision FROM declarations WHERE id = ?")
        .get(practice.declarationId),
    ).toEqual({ revision: 1 });
    expect(getOfficialFlowSummary(database, practice.id, practice.declarationId)).toMatchObject({
      stage: "diz-imported",
      stageLabel: "DIZ di partenza acquisito",
    });
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
