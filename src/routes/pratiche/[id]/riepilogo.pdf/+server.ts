import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { OFFICIAL_SOURCE_LABEL } from "../../../../domain/declaration.ts";
import { createDossierPdf } from "$lib/server/dossier-pdf";
import { openDatabase } from "$lib/server/database";
import {
  buildComplianceReport,
  listCalculationRuns,
  listDevolutionScenarios,
  listSharedAssets,
  listSharedSubjects,
} from "$lib/server/domain";
import { getDeclaration, getPractice } from "$lib/server/practices";

const roleLabels: Record<string, string> = {
  decedent: "Defunto",
  beneficiary: "Beneficiario",
  representative: "Rappresentante",
  other: "Altro soggetto",
};

const kindLabels: Record<string, string> = {
  land: "Terreno",
  building: "Fabbricato",
  tavolare_land: "Terreno nel sistema tavolare",
  tavolare_building: "Fabbricato nel sistema tavolare",
  company: "Azienda",
  securities: "Titoli o quote sociali",
  aircraft: "Aeromobile",
  vessel: "Nave o imbarcazione",
  money: "Denaro, gioielli o mobilia",
  inventory: "Beni descritti in inventario",
  other: "Altro bene o credito",
  liability: "Passività",
  donation: "Donazione precedente",
};

export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.ownerId) error(401, "Accesso richiesto");
  const database = openDatabase();
  const practice = getPractice(database, params.id);
  if (!practice) error(404, "Pratica non trovata");
  const declarationId = url.searchParams.get("dichiarazione") ?? practice.declarationId;
  const declaration = getDeclaration(database, declarationId, params.id);
  if (!declaration) error(404, "Dichiarazione non trovata");
  const subjects = listSharedSubjects(database, params.id);
  const assets = listSharedAssets(database, params.id);
  const report = buildComplianceReport(database, params.id, declaration.id);
  const devolution = listDevolutionScenarios(database, params.id, declaration.id).find(
    (scenario) => scenario.id === declaration.declaration.confirmedDevolutionScenarioId,
  );
  const calculation = listCalculationRuns(database, params.id, declaration.id).find(
    (run) => run.id === declaration.declaration.latestCalculationRunId,
  );
  const subjectNames = new Map(subjects.map((subject) => [subject.id, subject.displayName]));
  const assetNames = new Map(assets.map((asset) => [asset.id, asset.displayName]));
  const generatedAt = new Date().toISOString();
  const pdf = await createDossierPdf({
    title: practice.title,
    declarationLabel:
      declaration.declaration.declarationKind === "first"
        ? "Prima dichiarazione"
        : `Sostitutiva tipo ${declaration.declaration.declarationKind.at(-1)}`,
    revision: declaration.revision,
    successionDate: declaration.declaration.successionOpenedAt,
    generatedAt,
    ready: report.ready,
    digest: report.digest,
    officialSourceLabel: OFFICIAL_SOURCE_LABEL,
    subjects: subjects.map((subject) => ({
      name: subject.displayName,
      role: roleLabels[subject.role] ?? subject.role,
      taxCode: subject.taxCode,
    })),
    assets: assets.map((asset) => ({
      name: asset.displayName,
      kind: kindLabels[asset.kind] ?? asset.kind,
      valueCents: asset.valueCents,
      quadro: asset.quadro,
    })),
    shares: (devolution?.shares ?? []).map((share) => ({
      asset: assetNames.get(share.assetId ?? "") ?? "Bene non disponibile",
      beneficiary: subjectNames.get(share.beneficiaryId) ?? "Beneficiario non disponibile",
      numerator: share.numerator.toString(),
      denominator: share.denominator.toString(),
      valueCents: share.valueCents.toString(),
    })),
    calculation: calculation
      ? {
          totalTaxCents: calculation.totalTaxCents.toString(),
          beneficiaries: calculation.beneficiaries.map((result) => ({
            beneficiary: subjectNames.get(result.beneficiaryId) ?? "Beneficiario non disponibile",
            netEstateCents: result.an.toString(),
            allowanceCents: result.fr.toString(),
            grossTaxCents: result.isl.toString(),
            netTaxCents: result.isn.toString(),
          })),
        }
      : null,
    checklist: report.checklist
      .filter((item) => item.status !== "not_applicable")
      .map((item) => ({
        label: item.label,
        status:
          item.status === "available"
            ? "Disponibile"
            : item.status === "overridden"
              ? "Deroga motivata"
              : "Mancante",
      })),
    issues: report.issues.map((issue) => ({ message: issue.message, sourceId: issue.sourceId })),
  });
  return new Response(pdf as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="sequent-${params.id}-dossier.pdf"`,
      "cache-control": "private, no-store",
    },
  });
};
