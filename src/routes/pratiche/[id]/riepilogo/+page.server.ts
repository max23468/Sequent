import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { openDatabase } from "$lib/server/database";
import { listSharedAssets } from "$lib/server/domain-assets";
import { listCalculationRuns } from "$lib/server/domain-calculations";
import { buildComplianceReport } from "$lib/server/domain-compliance";
import { listDevolutionScenarios } from "$lib/server/domain-devolution";
import { listDeclarationDossierSubjects } from "$lib/server/domain-subjects";
import { getDeclaration, getPractice } from "$lib/server/practices";
import { OFFICIAL_SOURCE_LABEL } from "../../../../domain/declaration.ts";

export const load: PageServerLoad = ({ locals, params, url }) => {
  if (!locals.ownerId) redirect(303, "/login");
  const database = openDatabase();
  const practice = getPractice(database, params.id);
  if (!practice) error(404, "Pratica non trovata");
  const declarationId = url.searchParams.get("dichiarazione") ?? practice.declarationId;
  const declaration = getDeclaration(database, declarationId, params.id);
  if (!declaration) error(404, "Dichiarazione non trovata");
  const scenarios = listDevolutionScenarios(database, params.id, declaration.id);
  const calculations = listCalculationRuns(database, params.id, declaration.id);
  return {
    practice,
    declaration,
    subjects: listDeclarationDossierSubjects(database, params.id, declaration.id),
    assets: listSharedAssets(database, params.id, declaration.id),
    report: buildComplianceReport(database, params.id, declaration.id),
    devolution:
      scenarios.find(
        (scenario) => scenario.id === declaration.declaration.confirmedDevolutionScenarioId,
      ) ?? null,
    calculation:
      calculations.find(
        (calculation) => calculation.id === declaration.declaration.latestCalculationRunId,
      ) ?? null,
    generatedAt: new Date().toISOString(),
    officialSourceLabel: OFFICIAL_SOURCE_LABEL,
  };
};
