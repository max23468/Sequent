import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { openDatabase } from "$lib/server/database";
import {
  buildComplianceReport,
  listDeclarationSubjectEntries,
  listSharedAssets,
} from "$lib/server/domain";
import { createOfficialFacsimilePdf, OfficialFacsimileError } from "$lib/server/official-facsimile";
import { getDeclaration, getPractice } from "$lib/server/practices";

function facsimileErrorMessage(failure: OfficialFacsimileError): string {
  if (failure.code === "SOURCE_MISMATCH")
    return "Il modello ufficiale disponibile non coincide con la versione qualificata per questa dichiarazione.";
  if (failure.code === "VERSION_MISMATCH")
    return "La dichiarazione usa una versione di catalogo, regole o fonti ufficiali diversa da quella qualificata per il fac-simile.";
  if (failure.code === "VALUE_OVERFLOW")
    return `Il valore del campo ${failure.fieldId ?? "non identificato"} non entra nello spazio ufficiale senza essere troncato.`;
  return `Il campo ${failure.fieldId ?? "non identificato"} contiene un valore ma non dispone ancora di una posizione qualificata nel fac-simile ufficiale.`;
}

export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.ownerId) error(401, "Accesso richiesto");
  const database = openDatabase();
  const practice = getPractice(database, params.id);
  if (!practice) error(404, "Pratica non trovata");
  const declarationId = url.searchParams.get("dichiarazione") ?? practice.declarationId;
  const declaration = getDeclaration(database, declarationId, params.id);
  if (!declaration) error(404, "Dichiarazione non trovata");
  const requestedRevision = url.searchParams.get("revisione");
  if (requestedRevision && Number(requestedRevision) !== declaration.revision)
    error(
      409,
      "Questa revisione non dispone di uno snapshot completo e non può essere ricostruita come fac-simile.",
    );
  const report = buildComplianceReport(database, params.id, declaration.id);
  try {
    const pdf = await createOfficialFacsimilePdf({
      declaration: declaration.declaration,
      revision: declaration.revision,
      ready: report.ready,
      generatedAt: new Date().toISOString(),
      digest: report.digest,
      subjects: listDeclarationSubjectEntries(database, params.id, declaration.id).map(
        (subject) => ({ id: subject.id, sequence: subject.sequence }),
      ),
      assets: listSharedAssets(database, params.id, declaration.id).map((asset) => ({
        id: asset.id,
        quadro: asset.quadro,
      })),
    });
    const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(pdf as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${disposition}; filename="sequent-${params.id}-facsimile.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (failure) {
    if (failure instanceof OfficialFacsimileError) error(409, facsimileErrorMessage(failure));
    throw failure;
  }
};
