import { fail, redirect, type Action } from "@sveltejs/kit";
import { isDizEnabled } from "./config.ts";
import { openDatabase } from "./database.ts";
import {
  addOfficialArtifact,
  confirmPresentation,
  exportDiz,
  importDiz,
  OFFICIAL_ARTIFACT_KINDS,
  overrideOfficialStage,
  repairImportedDizAcquisition,
  reimportDiz,
  resolveDizConflicts,
  type OfficialStage,
  type UserOfficialArtifactKind,
} from "./official-flow.ts";

type PracticeAction = Action<{ id: string }>;

function officialFlowLocation(practiceId: string, declarationId: string): string {
  return `/pratiche/${practiceId}?sezione=official&dichiarazione=${declarationId}`;
}

const importDizAction: PracticeAction = async ({ locals, params, request }) => {
  if (!locals.ownerId) redirect(303, "/login");
  if (!isDizEnabled())
    return fail(403, { officialFlowError: "Il flusso DIZ è disattivato in questo ambiente." });
  const formData = await request.formData();
  const declarationId = String(formData.get("declarationId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return fail(400, { officialFlowError: "Scegli il DIZ da acquisire." });
  try {
    await importDiz(openDatabase(), { practiceId: params.id, declarationId, file });
  } catch (flowError) {
    if (flowError instanceof Error && flowError.message === "DIZ_ROUND_TRIP_PENDING")
      return fail(409, {
        officialFlowError: "Completa il ciclo DIZ già aperto prima di acquisire una nuova base.",
      });
    if (flowError instanceof Error && flowError.message === "DIZ_IMPORT_MAPPING_AMBIGUOUS")
      return fail(409, {
        officialFlowError:
          "Il DIZ contiene un codice che il convertitore ufficiale associa a più posizioni. L’acquisizione è bloccata per evitare un collegamento arbitrario.",
      });
    if (flowError instanceof Error)
      return fail(400, {
        officialFlowError: flowError.message.startsWith("DIZ ")
          ? flowError.message
          : "Il file non è un DIZ qualificato e integro.",
      });
    throw flowError;
  }
  redirect(303, officialFlowLocation(params.id, declarationId));
};

const repairImportedDizAction: PracticeAction = async ({ locals, params, request }) => {
  if (!locals.ownerId) redirect(303, "/login");
  if (!isDizEnabled())
    return fail(403, { officialFlowError: "Il flusso DIZ è disattivato in questo ambiente." });
  const formData = await request.formData();
  const declarationId = String(formData.get("declarationId") ?? "");
  const artifactId = String(formData.get("artifactId") ?? "");
  try {
    await repairImportedDizAcquisition(openDatabase(), { practiceId: params.id, artifactId });
  } catch (flowError) {
    if (flowError instanceof Error && flowError.message === "DIZ_IMPORT_NOT_FOUND")
      return fail(404, { officialFlowError: "Il DIZ acquisito non è più disponibile." });
    if (flowError instanceof Error && flowError.message === "DIZ_IMPORT_MAPPING_AMBIGUOUS")
      return fail(409, {
        officialFlowError:
          "Il DIZ contiene un codice che il convertitore ufficiale associa a più posizioni. La riparazione è bloccata senza scegliere per analogia.",
      });
    throw flowError;
  }
  redirect(303, officialFlowLocation(params.id, declarationId));
};

const exportDizAction: PracticeAction = async ({ locals, params, request }) => {
  if (!locals.ownerId) redirect(303, "/login");
  if (!isDizEnabled())
    return fail(403, { officialFlowError: "Il flusso DIZ è disattivato in questo ambiente." });
  const declarationId = String((await request.formData()).get("declarationId") ?? "");
  try {
    await exportDiz(openDatabase(), { practiceId: params.id, declarationId });
  } catch (flowError) {
    const messages: Record<string, string> = {
      DIZ_COMPLIANCE_BLOCKED:
        "Completa i controlli bloccanti e gli allegati prima di generare il DIZ.",
      DIZ_SOURCE_REQUIRED: "Acquisisci prima un DIZ qualificato da usare come base trasparente.",
      DIZ_ATTACHMENTS_NOT_QUALIFIED:
        "Gli allegati incorporati nel DIZ non coincidono con quelli preparati e controllati in Sequent.",
      DIZ_EG_ATTACHMENTS_NOT_QUALIFIED:
        "I contenitori e i contatori del Quadro EG nel DIZ non coincidono con gli allegati preparati in Sequent.",
      DIZ_ROUND_TRIP_PENDING: "Completa il ciclo DIZ già aperto prima di generarne uno nuovo.",
      DIZ_MAPPING_CONTEXT_UNSUPPORTED:
        "Il DIZ contiene una posizione mappata che non può essere associata in modo univoco alla dichiarazione.",
    };
    if (flowError instanceof Error && messages[flowError.message])
      return fail(400, { officialFlowError: messages[flowError.message] });
    throw flowError;
  }
  redirect(303, officialFlowLocation(params.id, declarationId));
};

const reimportDizAction: PracticeAction = async ({ locals, params, request }) => {
  if (!locals.ownerId) redirect(303, "/login");
  if (!isDizEnabled())
    return fail(403, { officialFlowError: "Il flusso DIZ è disattivato in questo ambiente." });
  const formData = await request.formData();
  const declarationId = String(formData.get("declarationId") ?? "");
  const roundTripId = String(formData.get("roundTripId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return fail(400, { officialFlowError: "Scegli il DIZ salvato da SuccessioniOnLine." });
  try {
    await reimportDiz(openDatabase(), {
      practiceId: params.id,
      declarationId,
      roundTripId,
      file,
    });
  } catch (flowError) {
    if (flowError instanceof Error && flowError.message === "DIZ_ALREADY_REIMPORTED")
      return fail(409, { officialFlowError: "Questo ciclo DIZ è già stato reimportato." });
    if (flowError instanceof Error && flowError.message === "DIZ_ROUND_TRIP_NOT_FOUND")
      return fail(404, { officialFlowError: "Il ciclo DIZ non è più disponibile." });
    if (flowError instanceof Error && flowError.message === "DIZ_MAPPING_CONTEXT_UNSUPPORTED")
      return fail(400, {
        officialFlowError:
          "Il DIZ contiene una posizione mappata che non può essere associata in modo univoco alla dichiarazione.",
      });
    if (flowError instanceof Error && flowError.message.startsWith("DIZ "))
      return fail(400, { officialFlowError: flowError.message });
    throw flowError;
  }
  redirect(303, officialFlowLocation(params.id, declarationId));
};

const resolveDizAction: PracticeAction = async ({ locals, params, request }) => {
  if (!locals.ownerId) redirect(303, "/login");
  const formData = await request.formData();
  const declarationId = String(formData.get("declarationId") ?? "");
  const roundTripId = String(formData.get("roundTripId") ?? "");
  const choices: Record<string, "current" | "official"> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("conflict:")) continue;
    if (value === "current" || value === "official") choices[key.slice("conflict:".length)] = value;
  }
  try {
    resolveDizConflicts(openDatabase(), {
      practiceId: params.id,
      declarationId,
      roundTripId,
      choices,
    });
  } catch (flowError) {
    if (flowError instanceof Error && flowError.message === "DIZ_CONFLICT_CHOICE_REQUIRED")
      return fail(400, {
        officialFlowError: "Scegli quale valore conservare per ogni differenza.",
      });
    throw flowError;
  }
  redirect(303, officialFlowLocation(params.id, declarationId));
};

const addOfficialArtifactAction: PracticeAction = async ({ locals, params, request }) => {
  if (!locals.ownerId) redirect(303, "/login");
  const formData = await request.formData();
  const declarationId = String(formData.get("declarationId") ?? "");
  const kind = String(formData.get("kind") ?? "") as UserOfficialArtifactKind;
  const file = formData.get("file");
  if (!OFFICIAL_ARTIFACT_KINDS.includes(kind))
    return fail(400, { officialFlowError: "Indica il tipo di esito da acquisire." });
  if (!(file instanceof File) || file.size === 0)
    return fail(400, { officialFlowError: "Scegli il file relativo all’esito." });
  const outcome = String(formData.get("outcome") ?? "");
  const metadata: Record<string, unknown> = {
    ...(outcome ? { outcome } : {}),
    ...(formData.get("registrationReference")
      ? { registrationReference: String(formData.get("registrationReference")) }
      : {}),
    ...(formData.get("registeredAt") ? { registeredAt: String(formData.get("registeredAt")) } : {}),
  };
  try {
    await addOfficialArtifact(openDatabase(), {
      practiceId: params.id,
      declarationId,
      kind,
      file,
      metadata,
    });
  } catch (flowError) {
    if (flowError instanceof Error && flowError.message === "SECOND_RECEIPT_REGISTRATION_REQUIRED")
      return fail(400, {
        officialFlowError:
          "Per una seconda ricevuta positiva indica data ed estremi di registrazione.",
      });
    if (
      flowError instanceof Error &&
      [
        "OFFICIAL_DIAGNOSTIC_OUTCOME_REQUIRED",
        "SECOND_RECEIPT_OUTCOME_REQUIRED",
        "CADASTRAL_OUTCOME_REQUIRED",
      ].includes(flowError.message)
    )
      return fail(400, { officialFlowError: "Indica l’esito coerente con il tipo di file." });
    throw flowError;
  }
  redirect(303, officialFlowLocation(params.id, declarationId));
};

const confirmPresentationAction: PracticeAction = async ({ locals, params, request }) => {
  if (!locals.ownerId) redirect(303, "/login");
  const formData = await request.formData();
  const declarationId = String(formData.get("declarationId") ?? "");
  try {
    confirmPresentation(openDatabase(), {
      practiceId: params.id,
      declarationId,
      reason: String(formData.get("reason") ?? ""),
      registrationReference: String(formData.get("registrationReference") ?? ""),
      registeredAt: String(formData.get("registeredAt") ?? ""),
    });
  } catch (flowError) {
    const messages: Record<string, string> = {
      PRESENTATION_REASON_INVALID:
        "Spiega in modo circostanziato perché la seconda ricevuta non è ottenibile.",
      PRESENTATION_REGISTRATION_REQUIRED: "Indica data ed estremi ufficiali della registrazione.",
      PRESENTATION_ALREADY_CONFIRMED: "La presentazione risulta già confermata.",
    };
    if (flowError instanceof Error && messages[flowError.message])
      return fail(400, { officialFlowError: messages[flowError.message] });
    throw flowError;
  }
  redirect(303, officialFlowLocation(params.id, declarationId));
};

const overrideOfficialStageAction: PracticeAction = async ({ locals, params, request }) => {
  if (!locals.ownerId) redirect(303, "/login");
  const formData = await request.formData();
  const declarationId = String(formData.get("declarationId") ?? "");
  try {
    overrideOfficialStage(openDatabase(), {
      practiceId: params.id,
      declarationId,
      stage: String(formData.get("stage") ?? "") as OfficialStage,
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (flowError) {
    const messages: Record<string, string> = {
      OFFICIAL_STAGE_INVALID: "Scegli uno stato valido.",
      OFFICIAL_STAGE_REASON_INVALID: "Motiva la correzione dello stato.",
      OFFICIAL_STAGE_EVIDENCE_REQUIRED:
        "Lo stato scelto richiede ricevute o esiti ufficiali che non risultano acquisiti.",
    };
    if (flowError instanceof Error && messages[flowError.message])
      return fail(400, { officialFlowError: messages[flowError.message] });
    throw flowError;
  }
  redirect(303, officialFlowLocation(params.id, declarationId));
};

export const officialFlowActions = {
  importDiz: importDizAction,
  repairImportedDiz: repairImportedDizAction,
  exportDiz: exportDizAction,
  reimportDiz: reimportDizAction,
  resolveDiz: resolveDizAction,
  addOfficialArtifact: addOfficialArtifactAction,
  confirmPresentation: confirmPresentationAction,
  overrideOfficialStage: overrideOfficialStageAction,
};
