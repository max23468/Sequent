import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { openDatabase } from "$lib/server/database";
import {
  buildComplianceReport,
  listCalculationRuns,
  listDevolutionScenarios,
  listSharedAssets,
  listSharedSubjects,
} from "$lib/server/domain";
import { getDeclaration, getPractice } from "$lib/server/practices";

export const GET: RequestHandler = ({ locals, params, url }) => {
  if (!locals.ownerId) error(401, "Accesso richiesto");
  const database = openDatabase();
  const practice = getPractice(database, params.id);
  if (!practice) error(404, "Pratica non trovata");
  const declarationId = url.searchParams.get("dichiarazione") ?? practice.declarationId;
  const declaration = getDeclaration(database, declarationId, params.id);
  if (!declaration) error(404, "Dichiarazione non trovata");
  const report = buildComplianceReport(database, params.id, declaration.id);
  const devolution = listDevolutionScenarios(database, params.id, declaration.id).find(
    (scenario) => scenario.id === declaration.declaration.confirmedDevolutionScenarioId,
  );
  const calculation = listCalculationRuns(database, params.id, declaration.id).find(
    (run) => run.id === declaration.declaration.latestCalculationRunId,
  );
  const payload = {
    generatedAt: new Date().toISOString(),
    practice: { id: practice.id, title: practice.title },
    declaration,
    subjects: listSharedSubjects(database, params.id),
    assets: listSharedAssets(database, params.id, declaration.id),
    devolution: devolution ?? null,
    calculation: calculation ?? null,
    report,
  };
  return json(
    JSON.parse(
      JSON.stringify(payload, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ),
    {
      headers: {
        "content-disposition": `attachment; filename="sequent-${params.id}-riepilogo.json"`,
      },
    },
  );
};
